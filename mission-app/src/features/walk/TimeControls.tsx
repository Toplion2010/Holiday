// Панель времени суток на Марсе: показания Солнца и режимы «реальное время» / «эксперимент».

import { useEffect, useRef, useState } from 'react';
import { formatSolClock, seasonLabel } from '@/features/sky/marsTime';
import type { WalkScene, SolarState } from './walkScene';

/** Местное истинное солнечное время, с которого начинаем, если на месте ночь. */
const START_LTST_IF_NIGHT = 9;
const NOTICE_MS = 12_000;

const PHASE_LABEL = { day: 'день', twilight: 'сумерки', night: 'ночь' } as const;

interface Props {
  scene: WalkScene | null;
  solar: SolarState | null;
}

export function TimeControls({ scene, solar }: Props) {
  const [open, setOpen] = useState(false);
  const [experiment, setExperiment] = useState(false);
  // Если на месте сейчас ночь, грунт почти не виден. Стартуем утром и прямо говорим об этом.
  const [nightNotice, setNightNotice] = useState<string | null>(null);
  const decided = useRef(false);
  useEffect(() => {
    if (decided.current || !scene || !solar) return;
    decided.current = true;
    if (solar.phase !== 'night') return;
    setNightNotice(`На месте сейчас ночь (${formatSolClock(solar.ltstHours)} LTST). Показано утро.`);
    setExperiment(true);
    scene.setClockRunning(false);
    scene.setLtst(START_LTST_IF_NIGHT);
  }, [scene, solar]);
  useEffect(() => {
    if (!nightNotice) return;
    const t = window.setTimeout(() => setNightNotice(null), NOTICE_MS);
    return () => window.clearTimeout(t);
  }, [nightNotice]);

  const chooseMode = (exp: boolean) => {
    setExperiment(exp);
    setNightNotice(null);
    scene?.setClockRunning(!exp);
    if (!exp) scene?.setSimTime(Date.now());
  };

  if (!open || !solar) {
    return (
      <div className="walk-time">
        <button type="button" className="walk-btn" onClick={() => setOpen(true)}>
          {solar ? `Время ${formatSolClock(solar.ltstHours)} · ${PHASE_LABEL[solar.phase]}${experiment ? ' · эксперимент' : ''}` : 'Время'}
        </button>
        {nightNotice && (
          <p className="walk-time-note">
            {nightNotice}{' '}
            <button type="button" className="walk-link" onClick={() => chooseMode(false)}>Показать реальное время</button>
          </p>
        )}
      </div>
    );
  }
  const fmt = (v: number, d: number) => v.toFixed(d).replace('.', ',');
  return (
    <div className="walk-time">
      <div className="walk-menu-row walk-time-head">
        <strong>Время на Марсе</strong>
        <button type="button" className="walk-btn" onClick={() => setOpen(false)}>Свернуть</button>
      </div>
      <dl className="walk-time-grid">
        <dt>Местное истинное солнечное время</dt>
        <dd>{formatSolClock(solar.ltstHours)} LTST</dd>
        <dt>Сольная дата (MSD)</dt>
        <dd>{fmt(solar.msd, 2)} сол</dd>
        <dt>Сезон</dt>
        <dd>Ls {fmt(solar.ls, 1)}° · {seasonLabel(solar.ls)}</dd>
        <dt>Высота Солнца</dt>
        <dd>{fmt(solar.elevationDeg, 1)}° · {PHASE_LABEL[solar.phase]}</dd>
        <dt>Поток на вершине атмосферы</dt>
        <dd>{Math.round(solar.irradianceWm2)} Вт/м²</dd>
      </dl>
      <div className="walk-menu-row" role="group" aria-label="Режим времени">
        <button type="button" className={`walk-btn ${!experiment ? 'is-on' : ''}`} onClick={() => chooseMode(false)}>Реальное время Марса</button>
        <button type="button" className={`walk-btn ${experiment ? 'is-on' : ''}`} onClick={() => chooseMode(true)}>Эксперимент</button>
      </div>
      {experiment && (
        <>
          <label className="walk-time-slider">
            <span>Время суток: {formatSolClock(solar.ltstHours)} LTST (0–24 ч)</span>
            <input type="range" min={0} max={24} step={0.05} value={solar.ltstHours} onChange={(e) => scene?.setLtst(Number(e.target.value))} />
          </label>
          <div className="walk-menu-row">
            <button type="button" className="walk-btn" onClick={() => scene?.setSunCrossing(true)}>Рассвет</button>
            <button type="button" className="walk-btn" onClick={() => scene?.setLtst(12)}>Полдень</button>
            <button type="button" className="walk-btn" onClick={() => scene?.setSunCrossing(false)}>Закат</button>
            <button type="button" className="walk-btn" onClick={() => scene?.setLtst(0)}>Полночь</button>
          </div>
          <label className="walk-time-slider">
            <span>Пыль: τ = {fmt(solar.tau, 2)} (безразмерная)</span>
            <input type="range" min={0.1} max={2} step={0.05} value={solar.tau} onChange={(e) => scene?.setTau(Number(e.target.value))} />
          </label>
        </>
      )}
      <p className="walk-muted">Модель: Mars24 (Allison &amp; McEwen). Панорама неба производная, её источник указывает команда. Оптическая толщина τ взята из модели, это не измерение.</p>
    </div>
  );
}
