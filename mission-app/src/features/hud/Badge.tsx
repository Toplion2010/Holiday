// Метка происхождения значения и строка «подпись — значение — метка» с подсказкой.
import type { ReactNode } from 'react';

import type { Provenance } from '@/app/modeContract';

const LABEL: Record<Provenance, string> = {
  data: 'данные',
  archive: 'архив',
  model: 'модель',
  nodata: 'нет данных',
};

export function Badge({ prov, date, tip }: { prov: Provenance; date?: string; tip: string }) {
  const text = prov === 'archive' && date ? `архив ${date}` : LABEL[prov];
  return (
    <span className={`hud-badge hud-badge--${prov}`} title={tip} tabIndex={-1}>
      {text}
    </span>
  );
}

export interface RowProps {
  label?: ReactNode;
  value: ReactNode;
  prov: Provenance;
  date?: string;
  tip: string;
  tone?: 'ok' | 'warn' | 'danger';
}

export function Row({ label, value, prov, date, tip, tone }: RowProps) {
  return (
    <div className={`hud-row${tone ? ` hud-row--${tone}` : ''}`}>
      {label !== undefined && <span className="hud-label">{label}</span>}
      <span className="hud-value">{value}</span>
      <Badge prov={prov} date={date} tip={tip} />
    </div>
  );
}
