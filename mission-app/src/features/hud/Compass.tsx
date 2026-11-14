// Компас-лента: стороны света, курс и метка базы с расстоянием.
import { formatDistance } from '@/shared/eva/suit';

import { Badge } from './Badge';

const HALF_FOV = 75;
const WIDTH = 360;
const PX_PER_DEG = WIDTH / (2 * HALF_FOV);
const NAMES: Record<number, string> = {
  0: 'С', 45: 'СВ', 90: 'В', 135: 'ЮВ', 180: 'Ю', 225: 'ЮЗ', 270: 'З', 315: 'СЗ',
};

const norm = (d: number) => ((d % 360) + 360) % 360;
/** Разность углов в диапазоне (−180, 180]. */
export function angleDelta(from: number, to: number): number {
  let d = norm(to - from);
  if (d > 180) d -= 360;
  return d;
}

export interface CompassProps {
  headingDeg: number;
  baseBearingDeg: number;
  baseDistanceM: number;
}

export function Compass({ headingDeg, baseBearingDeg, baseDistanceM }: CompassProps) {
  const ticks: { x: number; deg: number }[] = [];
  const start = Math.ceil((headingDeg - HALF_FOV) / 15) * 15;
  for (let d = start; d <= headingDeg + HALF_FOV; d += 15) {
    ticks.push({ x: WIDTH / 2 + (d - headingDeg) * PX_PER_DEG, deg: norm(d) });
  }
  const baseDelta = angleDelta(headingDeg, baseBearingDeg);
  const baseVisible = Math.abs(baseDelta) <= HALF_FOV;
  const baseX = WIDTH / 2 + Math.max(-HALF_FOV, Math.min(HALF_FOV, baseDelta)) * PX_PER_DEG;
  const atBase = baseDistanceM < 1;

  return (
    <div className="hud-compass" style={{ width: WIDTH }}>
      <div className="hud-compass-tape">
        {ticks.map(t => (
          <span
            key={t.deg + ':' + Math.round(t.x)}
            className={`hud-tick${NAMES[t.deg] ? ' hud-tick--major' : ''}`}
            style={{ left: t.x }}
          >
            {NAMES[t.deg] ?? (t.deg % 30 === 0 ? t.deg : '')}
          </span>
        ))}
        {!atBase && (
          <span
            className={`hud-base-marker${baseVisible ? '' : ' hud-base-marker--edge'}`}
            style={{ left: baseX }}
          >
            {!baseVisible && baseDelta < 0 ? '◄ ' : ''}Б {formatDistance(baseDistanceM)}
            {!baseVisible && baseDelta > 0 ? ' ►' : ''}
          </span>
        )}
        <span className="hud-compass-caret" style={{ left: WIDTH / 2 }} />
      </div>
      <div className="hud-compass-caption">
        курс {Math.round(norm(headingDeg))}° · база {atBase ? 'здесь' : `${Math.round(norm(baseBearingDeg))}°, ${formatDistance(baseDistanceM)}`}
        <Badge
          prov="data"
          tip="Курс: направление взгляда в градусах от севера по часовой стрелке. База: точка старта выхода, азимут и расстояние до неё по прямой по модели рельефа сцены."
        />
      </div>
    </div>
  );
}
