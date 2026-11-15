// Экран выхода (HUD) поверх вида от первого лица, docs/TZ_First_Person.md, раздел 6.
// Получает WalkState несколько раз в секунду. Клавиша H: «полный» → «скрыт» → «минимум».
// Сам слой не ловит мышь (pointer-events: none), кроме меток с подсказками и кнопки уровня.
import { useEffect, useMemo, useState } from 'react';

import type { WalkState } from '@/app/modeContract';
import { DOSE_RATE_MSV_DAY, distanceToGaleKm, evaDose, GALE, loadRad, type RadSummary } from '@/shared/eva/radiation';
import {
  DONKI_TYPE_LABEL,
  latestRelevantEvent,
  loadSpaceWeather,
  type SpaceWeather,
} from '@/shared/eva/spaceWeather';
import {
  darknessRisk,
  DEFAULT_EVA_BUDGET,
  evaBudget,
  formatDistance,
  formatDuration,
  slopeLevel,
} from '@/shared/eva/suit';
import { formatLightTime, interpolateLightTime, loadLightTimeTable, type LightTimeTable } from '@/shared/time/lightTime';
import {
  formatHours,
  lmstHours,
  ltstHours,
  marsTime,
  missionNear,
  missionSol,
  nextSunEvents,
  sunPosition,
} from '@/shared/time/mars24';

import { Row } from './Badge';
import { Compass } from './Compass';
import './hud.css';

export type HudLevel = 'min' | 'full' | 'hidden';
const NEXT_LEVEL: Record<HudLevel, HudLevel> = { min: 'full', full: 'hidden', hidden: 'min' };
const LEVEL_TITLE: Record<HudLevel, string> = { min: 'минимум', full: 'полный', hidden: 'скрыт' };

/** Внешние данные HUD; undefined — ещё грузится, null — нет данных. */
export interface HudExternal {
  lightTable?: LightTimeTable | null;
  rad?: RadSummary | null;
  spaceWeather?: SpaceWeather | null;
}

export interface HudProps {
  state: WalkState;
}

export function Hud({ state }: HudProps) {
  const [level, setLevel] = useState<HudLevel>('full');
  const [ext, setExt] = useState<HudExternal>({});

  useEffect(() => {
    let alive = true;
    loadLightTimeTable().then(lightTable => alive && setExt(e => ({ ...e, lightTable })));
    loadRad().then(rad => alive && setExt(e => ({ ...e, rad })));
    loadSpaceWeather(7).then(spaceWeather => alive && setExt(e => ({ ...e, spaceWeather })));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyH' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      setLevel(l => NEXT_LEVEL[l]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return <HudView state={state} ext={ext} level={level} onToggle={() => setLevel(l => NEXT_LEVEL[l])} />;
}

// --- форматирование ---------------------------------------------------------------------

const fmtLat = (lat: number) => `${Math.abs(lat).toFixed(4)}°${lat < 0 ? 'S' : 'N'}`;
const fmtLon = (lon: number) => `${(((lon % 360) + 360) % 360).toFixed(4)}°E`;
const fmtNum = (x: number, digits: number) => x.toFixed(digits).replace('.', ',').replace('-', '−');
const pad = (n: number) => String(n).padStart(2, '0');

function fmtUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function fmtViewer(ms: number): string {
  try {
    return new Date(ms).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return '—';
  }
}

const dateOnly = (iso: string) => (iso ? iso.slice(0, 10) : '');

// --- вид --------------------------------------------------------------------------------

export interface HudViewProps {
  state: WalkState;
  ext: HudExternal;
  level: HudLevel;
  onToggle?: () => void;
}

export function HudView({ state: s, ext, level, onToggle }: HudViewProps) {
  const t = useMemo(() => marsTime(s.simTimeMs), [s.simTimeMs]);
  // Закат и восход: перебор по времени, поэтому пересчёт раз в ~30 с модельного времени
  // и при сдвиге на ~0.01°.
  const bucket = Math.floor(s.simTimeMs / 30000);
  const latKey = Math.round(s.lat * 100);
  const lonKey = Math.round(s.lonEast * 100);
  const sunEvents = useMemo(
    () => nextSunEvents(bucket * 30000, latKey / 100, lonKey / 100),
    [bucket, latKey, lonKey],
  );

  const toggle = (
    <button type="button" className="hud-toggle" onClick={onToggle} title="Уровень экрана: минимум → полный → скрыт">
      HUD: {LEVEL_TITLE[level]} · H
    </button>
  );
  if (level === 'hidden') return <div className="hud walk-hud hud--hidden">{toggle}</div>;
  const full = level === 'full';
  const rover = s.vehicle === 'rover';

  const lmst = lmstHours(t, s.lonEast);
  const ltst = ltstHours(t, s.lonEast);
  const sun = sunPosition(t, s.lat, s.lonEast);
  const toSunset = sunEvents.sunset ? (sunEvents.sunset.utcMs - s.simTimeMs) / 1000 : null;
  const toSunrise = sunEvents.sunrise ? (sunEvents.sunrise.utcMs - s.simTimeMs) / 1000 : null;
  const mission = missionNear(s.lat, s.lonEast);
  const light = ext.lightTable ? interpolateLightTime(ext.lightTable, s.simTimeMs) : null;
  const budget = evaBudget(s.evaSeconds, s.baseDistanceM);
  const dark = darknessRisk(toSunset !== null && toSunset >= 0 ? toSunset : null, budget.backS) || sun.elevationDeg < 0;
  const hereTone = slopeLevel(s.slopeHereDeg, s.maxSlopeDeg);
  const aheadTone = slopeLevel(s.slopeAheadDeg, s.maxSlopeDeg);
  const scale = s.timeScale > 1 ? <span className="hud-scale">×{s.timeScale}</span> : null;

  const marsTimeTip =
    'Алгоритм NASA GISS Mars24 (Allison & McEwen 2000), расчёт в браузере по модельным часам выхода. ' +
    'Точность ~1 с для LMST. Долгота восточная.';
  const slopeTip =
    `Уклон в градусах по модели рельефа сцены (${s.dataLevel}). Зелёный: до 15°, жёлтый: до порога ` +
    `${s.maxSlopeDeg}°, красный: выше. Порог взят из правил планирования, это не норматив NASA (ТЗ EVA 9.3). ` +
    'Разные модели рельефа дают разный уклон, и допуск сравним с порогом.';

  return (
    <div className="hud walk-hud" aria-live="off">
      <div className="hud-visor" />

      {/* Положение */}
      <section className="hud-panel hud-tl">
        <Row
          value={`${fmtLat(s.lat)} ${fmtLon(s.lonEast)}`}
          prov="data"
          tip="Planetocentric широта и восточная долгота 0–360°, 4 знака ≈ 6 м. Положение в локальной сцене, привязанной к DTM."
        />
        <Row
          label="Высота"
          value={`${fmtNum(Math.round(s.heightM), 0)} м`}
          prov="data"
          tip={`Высота поверхности под ногами из DTM, м относительно ареоида. Продукт: ${s.dataLevel}.`}
        />
        {full && (
          <>
            <Row label="Курс" value={`${Math.round(((s.headingDeg % 360) + 360) % 360)}°`} prov="data" tip="Курс ровера (пешком — направление взгляда), градусы от севера по часовой." />
            <Row label="Пройдено" value={formatDistance(s.walkedM)} prov="data" tip="Длина фактического пути от старта, м, по точкам сцены." />
            <Row label="Данные" value={s.dataLevel} prov="data" tip="Уровень данных рельефа под ногами. Где подробного DTM нет, рельеф грубее и детали не выдумываются." />
          </>
        )}
      </section>

      {/* Компас */}
      <section className="hud-tc">
        <Compass headingDeg={s.headingDeg} baseBearingDeg={s.baseBearingDeg} baseDistanceM={s.baseDistanceM} />
      </section>

      {/* Время */}
      <section className="hud-panel hud-tr">
        <Row label={<>LMST {scale}</>} value={formatHours(lmst, full)} prov="model" tip={`Местное среднее солнечное время на долготе игрока. ${marsTimeTip}`} />
        <Row label="LTST" value={formatHours(ltst, full)} prov="model" tip={`Местное истинное солнечное время = LMST + уравнение времени (${fmtNum(t.eotDeg / 15 * 60, 1)} мин). ${marsTimeTip}`} />
        {full && (
          <>
            <Row
              label="MSD"
              value={`${fmtNum(t.msd, 3)} · Ls ${fmtNum(t.lsDeg, 1)}°`}
              prov="model"
              tip={`Mars Sol Date: сквозной счёт солов. Ls: солнечная долгота Марса, по ней определяют сезон. ${marsTimeTip}`}
            />
            {mission && (
              <Row
                label={mission.title}
                value={`sol ${missionSol(mission, s.simTimeMs)}`}
                prov="model"
                tip={`Сол миссии: сол посадки считается sol 0, отсчёт по LMST на ${mission.clockLonEastDeg}° в. д. (часы миссии). Источник соглашения: NASA, Mars24.`}
              />
            )}
          </>
        )}
        <Row label="UTC" value={fmtUtc(s.simTimeMs)} prov="data" tip="Земное время UTC по модельным часам выхода (при ускорении идёт быстрее реального)." />
        {full && (
          <>
            <Row label="У вас" value={fmtViewer(s.simTimeMs)} prov="data" tip="То же модельное время в часовом поясе вашего браузера." />
            <Row
              label="Связь с Землёй"
              value={light ? formatLightTime(light.oneWayS) : 'нет данных'}
              prov={light ? 'model' : 'nodata'}
              tip={
                light
                  ? `Время света в одну сторону, расстояние ${fmtNum(light.distanceAu, 3)} а.е. Интерполяция по таблице ${light.source} (создана ${light.generatedUtc}). Без задержек ретрансляции.`
                  : 'Таблицы расстояний JPL Horizons нет, или момент вне её диапазона, поэтому число не показано.'
              }
            />
            <Row
              label="Солнце"
              value={`${fmtNum(sun.elevationDeg, 0)}°, аз. ${Math.round(sun.azimuthDeg)}°`}
              prov="model"
              tip={`Высота центра Солнца над ровным горизонтом и азимут от севера, Mars24 (D-5, D-6). Рельеф и сумерки не учтены.`}
            />
            <Row
              label={sun.elevationDeg > 0 ? 'Закат через' : 'Восход через'}
              value={
                sun.elevationDeg > 0
                  ? toSunset !== null ? formatDuration(toSunset) : 'нет в ближайший сол'
                  : toSunrise !== null ? formatDuration(toSunrise) : 'нет в ближайший сол'
              }
              prov="model"
              tip="Земные часы и минуты до пересечения центром Солнца ровного горизонта, по модельному времени. Холмы и стенки кратера закрывают Солнце раньше."
            />
          </>
        )}
      </section>

      {/* Безопасность и радиация */}
      <section className="hud-panel hud-bl">
        {dark && (
          <div className="hud-alert">
            {sun.elevationDeg < 0
              ? 'Темно: Солнце под горизонтом'
              : `До заката ${formatDuration(toSunset ?? 0)}, это меньше времени возврата`}
          </div>
        )}
        {budget.pastNoReturn && <div className="hud-alert hud-alert--danger">Точка невозврата: пора на базу</div>}
        <Row
          label="Уклон"
          value={
            <>
              <span className={`hud-tone--${hereTone}`}>под ногами {Math.round(Math.abs(s.slopeHereDeg))}°</span>
              {' · '}
              {Number.isFinite(s.slopeAheadDeg) ? (
                <span className={`hud-tone--${aheadTone}`}>
                  впереди {s.slopeAheadDeg >= 0 ? '▲' : '▼'} {Math.round(Math.abs(s.slopeAheadDeg))}°
                </span>
              ) : (
                <span>впереди: нет данных</span>
              )}
            </>
          }
          prov="data"
          tip={slopeTip}
        />
        {rover && (
          <div className="hud-note">
            Вы в ровере: показатели скафандра (ресурс, запас, доза за выход) нужны при выходе пешком.
          </div>
        )}
        {!rover && <Row
          label="Возврат"
          value={`${formatDuration(budget.backS)} · ${formatDistance(s.baseDistanceM)}`}
          prov="model"
          tip="Время пути на базу по прямой со скоростью по ровному 0,75 м/с: V = −0,01·θ + 0,75 м/с, калибровка по выходам Apollo (ТЗ EVA 9.1). Обходы и уклоны не учтены, поэтому реальное время больше."
        />}
        {full && !rover && (
          <>
            <Row
              label="Ресурс"
              value={`осталось ${formatDuration(Math.max(0, budget.leftS))} из ${formatDuration(DEFAULT_EVA_BUDGET.designS)}`}
              prov="model"
              tip="Расходники по проектному выходу 8 ч при средней мощности 350 Вт (ТЗ EVA 9.2). Расход у людей плохо предсказуем: у Apollo факт расходился с прогнозом в обе стороны. Чаще всего первой кончается вода на охлаждение."
            />
            <Row
              label="Запас"
              value={budget.pastNoReturn ? 'нет, возвращайтесь сейчас' : `можно отойти ещё ${formatDistance(budget.extraOutM)}`}
              prov="model"
              tone={budget.pastNoReturn ? 'danger' : budget.slackS < 1800 ? 'warn' : undefined}
              tip="Остаток минус время возврата минус резерв 30 мин. Правило: возврат должен быть возможен при любом одиночном отказе (ТЗ EVA 9.2)."
            />
          </>
        )}
        {full && <RadiationRows state={s} rad={ext.rad} rover={rover} />}
        {full && <SpaceWeatherRow sw={ext.spaceWeather} />}
      </section>

      {/* Ближайшая точка трека */}
      {full && (
        <section className="hud-panel hud-bc">
          {s.nearestTrackPoint ? (
            <Row
              label="Рядом"
              value={`${s.nearestTrackPoint.mission}, sol ${s.nearestTrackPoint.sol}, ${formatDistance(s.nearestTrackPoint.distanceM)}`}
              prov="data"
              tip="Ближайшая точка пути ровера по файлу локализаций NASA MMGIS. Поле sol показывает сол заезда."
            />
          ) : (
            <Row label="Трек ровера" value="рядом нет" prov="nodata" tip="В этой сцене нет маршрута ровера." />
          )}
        </section>
      )}

      {toggle}
    </div>
  );
}

function RadiationRows({ state: s, rad, rover = false }: { state: WalkState; rad: RadSummary | null | undefined; rover?: boolean }) {
  const galeKm = distanceToGaleKm(s.lat, s.lonEast);
  const inGale = galeKm <= GALE.radiusKm;
  const dose = evaDose(s.evaSeconds);
  const r = DOSE_RATE_MSV_DAY;
  const doseDigits = dose.typicalMSv < 0.1 ? 3 : 2;

  let measured;
  if (rad === undefined) {
    measured = <Row label="Радиация" value="загрузка…" prov="nodata" tip="Запрос архива RAD к серверу." />;
  } else if (!inGale) {
    measured = (
      <Row
        label="Радиация"
        value={`местных измерений нет; ближайшие: RAD, кратер Гейл, ${Math.round(galeKm)} км`}
        prov="nodata"
        tip="На поверхности дозу измеряли только приборы на роверах. Для этой точки измерений нет. Расстояние до кратера Гейл указано по дуге."
      />
    );
  } else if (rad === null) {
    measured = <Row label="Радиация" value="нет данных" prov="nodata" tip="Архив RAD недоступен (сервер не ответил или набор не установлен)." />;
  } else {
    measured = (
      <Row
        label="RAD, Гейл"
        value={`${fmtNum(rad.rateMicroGyH, 1)} мкГр/ч${rad.sol !== null ? ` · sol ${rad.sol}` : ''}`}
        prov="archive"
        date={dateOnly(rad.startUtc)}
        tip={
          `Curiosity RAD, канал B: средняя мощность поглощённой дозы по ${rad.observations} замерам, ` +
          `${rad.startUtc} — ${rad.endUtc}. Файл: ${rad.sourceFile}. Это архив, не текущие условия. ` +
          rad.limitations.join(' ')
        }
      />
    );
  }

  return (
    <>
      {measured}
      <Row
        label="Экв. доза"
        value={`${fmtNum(r.typical, 2)} ± ${fmtNum(r.sigma, 2)} мЗв/сут`}
        prov="model"
        tip={
          `Типичная эквивалентная доза на поверхности по RAD; по солнечному циклу ${fmtNum(r.min, 2)}–${fmtNum(r.max, 2)} мЗв/сут ` +
          '(ТЗ EVA 9.4). Коэффициент качества ~3 (3,05 ± 0,3; по уточнению 2019 года 2,1–2,7). Сутки земные. Высота и рельеф не учтены.'
        }
      />
      {!rover && <Row
        label="Доза за выход"
        value={`≈ ${fmtNum(dose.typicalMSv, doseDigits)} мЗв (${fmtNum(dose.lowMSv, doseDigits)}–${fmtNum(dose.highMSv, doseDigits)})`}
        prov="model"
        tip={`Мощность × время выхода (${formatDuration(s.evaSeconds)} по модельным часам). По солнечному циклу: ${fmtNum(dose.cycleMinMSv, doseDigits)}–${fmtNum(dose.cycleMaxMSv, doseDigits)} мЗв.`}
      />}
    </>
  );
}

function SpaceWeatherRow({ sw }: { sw: SpaceWeather | null | undefined }) {
  const note = 'DONKI описывает обстановку у Земли. Время прихода к Марсу оценочное.';
  if (sw === undefined) return null;
  const ev = latestRelevantEvent(sw);
  if (!sw || !ev) {
    return (
      <>
      <Row
        label="Солнце (DONKI)"
        value={sw ? 'событий за 7 дней нет' : 'нет данных'}
        prov={sw ? 'data' : 'nodata'}
        tip={sw ? `${sw.source}, запрос ${sw.fetched_utc}. ${sw.note || note}` : `Каталог NASA DONKI недоступен. ${note}`}
      />
      {sw && <div className="hud-note">{note}</div>}
      </>
    );
  }
  return (
    <>
      <Row
        label="Солнце (DONKI)"
        value={`${DONKI_TYPE_LABEL[ev.type] ?? ev.type} ${fmtUtc(Date.parse(ev.start_utc)).slice(0, 16)} UTC`}
        prov="data"
        tone="warn"
        tip={`${ev.summary} ${ev.link} · ${sw.source}, запрос ${sw.fetched_utc}. ${sw.note || note}`}
      />
      <div className="hud-note">{note}</div>
    </>
  );
}
