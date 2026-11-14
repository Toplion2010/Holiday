// Режим «От первого лица»: выбор участка или прогулка по пакету рельефа HiRISE.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ModeContext, WalkState } from '@/app/modeContract';
import { Hud } from '@/features/hud/Hud';
import { SLOPE_THRESHOLDS } from './motion';
import { fetchManifest, fetchSiteIndex, loadSitePackage, siteBaseUrl, type SiteIndexEntry, type SitePackage } from './sitePackage';
import { MARS_RADIUS_KM } from '@/features/globe/tiles';
import { ASCENT_M, ROVER_REAL_SPEED_MS, ROVER_SPEED_MS, TIME_SCALES, WalkScene, type TeleportTarget, type WalkExtra, type WalkSceneHooks } from './walkScene';

/** Подъём камеры перед переходом на шар. */
const ASCENT_MS = 1400;
import { TimeControls } from './TimeControls';
import { Joystick, TouchLook } from './TouchControls';
import './walk.css';

/** ARES game layer: scene hooks plus extra UI over the walk view. Optional. */
export interface WalkGameBridge {
  hooks: WalkSceneHooks;
  onScene?(scene: WalkScene | null): void;
  onState?(state: WalkState, extra: WalkExtra): void;
  overlay?: ReactNode;
}

export default function WalkPanel(props: ModeContext & { game?: WalkGameBridge }) {
  const { game, ...ctx } = props;
  const site = ctx.params.site;
  if (!site) return <SiteChooser ctx={ctx} />;
  return (
    <div className="walk-root">
      <WalkSite key={site} site={site} ctx={ctx} game={game} />
    </div>
  );
}

function useEscExit(exit: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') exit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exit, enabled]);
}

/** Пакет участка, начатый загружаться во время спуска, чтобы сцена открылась без экрана загрузки. */
const preloads = new Map<string, Promise<SitePackage>>();
/** Участок, в который прилетаем с шара: сцена начнёт сверху и опустится к старту. */
let pendingArrival: { site: string; at: number } | null = null;
const ARRIVAL_TTL_MS = 20_000;

/** Без побочных эффектов (StrictMode вызывает инициализаторы дважды); сброс — clearArrival. */
function peekArrival(site: string): boolean {
  return pendingArrival?.site === site && performance.now() - pendingArrival.at < ARRIVAL_TTL_MS;
}

function clearArrival(): void {
  pendingArrival = null;
}

/** Обзор участка с шара: ~120 км над центром. */
const OVERVIEW_ALTITUDE = 120 / MARS_RADIUS_KM;
const OVERVIEW_FLY_MS = 2200;
const DESCENT_MS = 3200;

interface ChooserSite extends SiteIndexEntry {
  note?: string;
  /** Точка старта — первая метка участка. */
  spawn: { lat: number; lon: number };
}

function SiteChooser({ ctx, notice }: { ctx: ModeContext; notice?: string }) {
  const [sites, setSites] = useState<ChooserSite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [descending, setDescending] = useState(false);
  useEscExit(ctx.exit, !descending);

  useEffect(() => {
    let alive = true;
    fetchSiteIndex()
      .then(async (list) => {
        const full = await Promise.all(
          list.map(async (s): Promise<ChooserSite> => {
            try {
              const m = await fetchManifest(s.id);
              const poi = m.pois?.[0];
              return { ...s, note: m.note, spawn: poi ? { lat: poi.lat, lon: poi.lon_east } : { lat: s.center.lat, lon: s.center.lon_east } };
            } catch {
              return { ...s, spawn: { lat: s.center.lat, lon: s.center.lon_east } };
            }
          }),
        );
        if (!alive) return;
        setSites(full);
        setSelected((cur) => cur ?? full[0]?.id ?? null);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  // Выбор участка — камера шара летит к нему.
  useEffect(() => {
    const s = sites?.find((x) => x.id === selected);
    if (!s || descending) return;
    void ctx.globe.flyTo({ lon: s.center.lon_east, lat: s.center.lat, altitude: OVERVIEW_ALTITUDE }, OVERVIEW_FLY_MS);
  }, [selected, sites, ctx.globe, descending]);

  const descend = async (s: ChooserSite) => {
    if (descending) return;
    setDescending(true);
    if (!preloads.has(s.id)) preloads.set(s.id, loadSitePackage(s.id));
    // Дальний план и модель ровера — тоже заранее, чтобы при посадке они уже были в кэше браузера.
    void fetchManifest(s.id)
      .then((m) => m.backdrop && fetch(siteBaseUrl(s.id) + m.backdrop.file))
      .catch(() => undefined);
    void fetch(`${import.meta.env.BASE_URL}models/perseverance.glb`).catch(() => undefined);
    // Сверху вниз к точке старта; дальше сцена прогулки продолжит спуск до мачты ровера.
    await ctx.globe.flyTo({ lon: s.spawn.lon, lat: s.spawn.lat, altitude: ASCENT_M / 1000 / MARS_RADIUS_KM }, DESCENT_MS);
    pendingArrival = { site: s.id, at: performance.now() };
    ctx.openMode('walk', { site: s.id });
  };

  return (
    <div className="walk-chooser-panel">
      <p className="walk-chooser-lead">
        Подробная модель рельефа HiRISE (сетка 1–2 м) есть только на этих участках. Выберите участок: камера покажет его на шаре.
      </p>
      {notice && <p className="walk-notice">{notice}</p>}
      {error && <p className="walk-notice">{error}</p>}
      {!sites && !error && <p className="walk-chooser-lead">Загрузка списка…</p>}
      <div className="walk-chooser-list">
        {sites?.map((s) => {
          const on = s.id === selected;
          return (
            <div key={s.id} className={`walk-pick${on ? ' is-on' : ''}`}>
              <button type="button" className="walk-pick-main" disabled={descending} onClick={() => setSelected(s.id)}>
                <strong>{s.title}</strong>
                <small>
                  {Math.abs(s.center.lat).toFixed(3)}° {s.center.lat >= 0 ? 'с. ш.' : 'ю. ш.'}, {s.center.lon_east.toFixed(3)}° в. д.
                </small>
                {on && s.note && <span>{s.note}</span>}
              </button>
              {on && (
                <button type="button" className="walk-pick-go" disabled={descending} onClick={() => void descend(s)}>
                  {descending ? 'Спуск…' : 'Спуститься'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WalkSite({ site, ctx, game }: { site: string; ctx: ModeContext; game?: WalkGameBridge }) {
  const [pkg, setPkg] = useState<SitePackage | null>(null);
  const [status, setStatus] = useState<'loading' | 'missing' | 'error' | 'ready'>('loading');
  const [error, setError] = useState('');
  useEscExit(ctx.exit, status === 'loading' || status === 'error');

  useEffect(() => {
    const ac = new AbortController();
    let loaded: SitePackage | null = null;
    setStatus('loading');
    (async () => {
      try {
        const index = await fetchSiteIndex();
        if (!index.some((s) => s.id === site)) {
          setStatus('missing');
          return;
        }
        const pre = preloads.get(site);
        preloads.delete(site);
        loaded = await (pre ?? loadSitePackage(site, ac.signal));
        if (ac.signal.aborted) {
          loaded.ortho.close();
          loaded.orthoHi?.close();
          return;
        }
        setPkg(loaded);
        setStatus('ready');
      } catch (e) {
        if (ac.signal.aborted) return;
        setError((e as Error).message);
        setStatus('error');
      }
    })();
    return () => {
      ac.abort();
      loaded?.ortho.close();
      loaded?.orthoHi?.close();
    };
  }, [site]);

  if (status === 'missing') {
    return <SiteChooser ctx={ctx} notice="Подробного рельефа здесь нет, доступен только обзорный режим. Выберите участок с DTM HiRISE." />;
  }
  if (status === 'error') {
    return (
      <div className="walk-center">
        <p>Не удалось загрузить участок: {error}</p>
        <button type="button" className="walk-btn" onClick={ctx.exit}>На глобус</button>
      </div>
    );
  }
  if (status === 'loading' || !pkg) {
    return (
      <div className="walk-center">
        <p>Загрузка рельефа HiRISE…</p>
        <button type="button" className="walk-btn" onClick={ctx.exit}>На глобус</button>
      </div>
    );
  }
  return <WalkView pkg={pkg} ctx={ctx} game={game} />;
}

function WalkView({ pkg, ctx, game }: { pkg: SitePackage; ctx: ModeContext; game?: WalkGameBridge }) {
  const gameRef = useRef(game);
  gameRef.current = game;
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<WalkScene | null>(null);
  const [state, setState] = useState<WalkState | null>(null);
  const [extra, setExtra] = useState<WalkExtra | null>(null);
  const [teleports, setTeleports] = useState<TeleportTarget[]>([]);
  const [menu, setMenu] = useState<'none' | 'settings' | 'teleport'>('none');
  const [shadows, setShadows] = useState(true);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [touch] = useState(() => window.matchMedia?.('(pointer: coarse)').matches ?? false);
  const [arrive] = useState(() => peekArrival(pkg.manifest.id));
  // «На глобус»: камера поднимается и смотрит вниз, затем шар отлетает от этой же точки.
  const leaving = useRef(false);
  const leave = () => {
    const s = sceneRef.current;
    if (!s) return ctx.exit();
    if (leaving.current) return;
    leaving.current = true;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    void s.ascend(reduce ? 0 : ASCENT_MS).then(() => ctx.exitFrom(s.exitOrigin()));
  };
  const exitRef = useRef(leave);
  exitRef.current = leave;

  useEffect(() => {
    const host = hostRef.current;
    const labels = labelsRef.current;
    if (!host || !labels) return;
    let scene: WalkScene;
    try {
      scene = new WalkScene({
        container: host,
        labels,
        minimap: minimapRef.current,
        pkg,
        touch,
        arrive,
        onState: (s, x) => {
          setState(s);
          setExtra(x);
          gameRef.current?.onState?.(s, x);
        },
        onExit: () => exitRef.current(),
        hooks: gameRef.current?.hooks,
      });
    } catch (e) {
      setWebglError((e as Error).message);
      return;
    }
    sceneRef.current = scene;
    gameRef.current?.onScene?.(scene);
    clearArrival();
    setTeleports([...scene.teleports]);
    setShadows(scene.shadows);
    return () => {
      sceneRef.current = null;
      gameRef.current?.onScene?.(null);
      scene.dispose();
    };
  }, [pkg, touch]);

  const s = sceneRef.current;
  const credit = pkg.manifest.sources?.find((x) => x.role === 'dtm');

  if (webglError) {
    return (
      <div className="walk-center">
        <p>WebGL недоступен: {webglError}</p>
        <button type="button" className="walk-btn" onClick={leave}>На глобус</button>
      </div>
    );
  }

  return (
    <>
      <div ref={hostRef} className="walk-host" />
      <div ref={labelsRef} className="walk-labels" />
      {touch && <TouchLook onLook={(dx, dy) => sceneRef.current?.lookBy(dx, dy)} />}
      {touch && <Joystick onMove={(x, y) => sceneRef.current?.setJoystick(x, y)} />}
      {state && <Hud state={state} />}
      <TimeControls scene={sceneRef.current} solar={extra?.solar ?? null} />

      <div className="walk-topbar">
        <button type="button" className="walk-btn" onClick={leave}>На глобус</button>
        <div className="walk-timescale" role="group" aria-label="Чем перемещаться">
          <button type="button" className={`walk-btn ${state?.vehicle !== 'walk' ? 'is-on' : ''}`} onClick={() => s?.setVehicle('rover')}>Ровер</button>
          <button type="button" className={`walk-btn ${state?.vehicle === 'walk' ? 'is-on' : ''}`} onClick={() => s?.setVehicle('walk')}>Пешком</button>
        </div>
        <button type="button" className={`walk-btn ${menu === 'teleport' ? 'is-on' : ''}`} onClick={() => setMenu(menu === 'teleport' ? 'none' : 'teleport')}>
          Перейти к точке
        </button>
        <button type="button" className={`walk-btn ${menu === 'settings' ? 'is-on' : ''}`} onClick={() => setMenu(menu === 'settings' ? 'none' : 'settings')}>
          Настройки
        </button>
        <div className="walk-timescale" role="group" aria-label="Ускорение времени">
          {TIME_SCALES.map((k, i) => (
            <button key={k} type="button" title={`Клавиша ${i + 1}`} className={`walk-btn ${state?.timeScale === k ? 'is-on' : ''}`} onClick={() => s?.setTimeScale(k)}>
              ×{k}
            </button>
          ))}
        </div>
      </div>

      {menu === 'teleport' && (
        <div className="walk-menu">
          {teleports.map((t) => (
            <button key={t.id} type="button" className="walk-menu-item" onClick={() => { s?.teleport(t.x, t.z); setMenu('none'); }}>
              {t.label}
            </button>
          ))}
          <p className="walk-muted">Или щёлкните по мини-карте.</p>
        </div>
      )}

      {menu === 'settings' && (
        <div className="walk-menu">
          <div className="walk-menu-row">
            <span>Порог уклона</span>
            {SLOPE_THRESHOLDS.map((d) => (
              <button key={d} type="button" className={`walk-btn ${state?.maxSlopeDeg === d ? 'is-on' : ''}`} onClick={() => s?.setMaxSlope(d)}>
                {d}°
              </button>
            ))}
          </div>
          <p className="walk-muted">
            20°: эксплуатационное правило инструмента планирования NASA. 15°: консервативный порог из планов миссий. 25°: ориентир «доступно пешком». Числового требования NASA нет.
          </p>
          <label className="walk-menu-row">
            <input type="checkbox" checked={shadows} onChange={(e) => { s?.setShadows(e.target.checked); setShadows(e.target.checked); }} />
            <span>Тени от рельефа</span>
          </label>
          {state?.vehicle !== 'walk' && (
            <p className="walk-muted">
              Ровер Perseverance (модель NASA). Скорость в сцене {ROVER_SPEED_MS.toFixed(1).replace('.', ',')} м/с: это примерно в{' '}
              {Math.round(ROVER_SPEED_MS / ROVER_REAL_SPEED_MS)} раз быстрее настоящего ровера ({(ROVER_REAL_SPEED_MS * 100).toFixed(1).replace('.', ',')} см/с), иначе по участку не проехать.
            </p>
          )}
          <p className="walk-muted">
            Скорость ходьбы задаёт симуляция: V = −0,01·θ + 0,75 м/с по модели выходов Apollo, но не меньше 0,1 м/с.
            {extra ? ` Сейчас ${extra.speedMs.toFixed(2).replace(".", ",")} м/с.` : ''}
          </p>
          <p className="walk-muted">Кадров в секунду: {extra ? Math.round(extra.fps) : '—'}</p>
        </div>
      )}

      <div className="walk-minimap">
        <canvas ref={minimapRef} title="Щёлкните, чтобы перейти в точку" />
        <div className="walk-minimap-credit">
          {credit ? `${credit.product} · ${credit.credit ?? ''}` : ''}
          {pkg.manifest.backdrop ? ` · ${pkg.manifest.backdrop.label}` : ''}
        </div>
      </div>

      {extra?.blocked && (
        <div className="walk-blocked">
          {extra.blocked === 'nodata'
            ? 'Дальше нет данных рельефа, шагнуть нельзя'
            : `Слишком круто: ${Math.round(extra.blockedSlopeDeg)}° при пороге ${state?.maxSlopeDeg ?? ''}°`}
        </div>
      )}

      {!touch && extra && !extra.locked && !extra.lifting && menu === 'none' && (
        <div className="walk-hint" onClick={() => s?.lock()}>
          {state?.vehicle === 'walk' ? (
            <>
              <strong>Щёлкните, чтобы идти</strong>
              <span>WASD или стрелки — шаг, мышь — взгляд, 1/2/3 — время ×1/×10/×60, Esc — отпустить мышь, Esc ещё раз — на глобус</span>
            </>
          ) : (
            <>
              <strong>Щёлкните, чтобы ехать</strong>
              <span>W/S — вперёд и назад, A/D — поворот, мышь — взгляд с мачты, 1/2/3 — время ×1/×10/×60, Esc — отпустить мышь, Esc ещё раз — на глобус</span>
            </>
          )}
        </div>
      )}
      {game?.overlay}
    </>
  );
}
