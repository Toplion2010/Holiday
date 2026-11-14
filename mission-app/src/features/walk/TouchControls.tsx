// Сенсорное управление: джойстик слева — шаг, протяжка справа — взгляд.

import { useRef, useState } from 'react';

const RADIUS = 56;

export function Joystick({ onMove }: { onMove(x: number, y: number): void }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const center = useRef<{ x: number; y: number; id: number } | null>(null);

  const update = (e: React.PointerEvent) => {
    const c = center.current;
    if (!c || e.pointerId !== c.id) return;
    let dx = e.clientX - c.x;
    let dy = e.clientY - c.y;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS;
      dy = (dy / len) * RADIUS;
    }
    setKnob({ x: dx, y: dy });
    onMove(dx / RADIUS, -dy / RADIUS);
  };
  const end = () => {
    center.current = null;
    setKnob({ x: 0, y: 0 });
    onMove(0, 0);
  };

  return (
    <div
      className="walk-joystick"
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        center.current = { x: r.left + r.width / 2, y: r.top + r.height / 2, id: e.pointerId };
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={update}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div className="walk-joystick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}

export function TouchLook({ onLook }: { onLook(dx: number, dy: number): void }) {
  const last = useRef<{ x: number; y: number; id: number } | null>(null);
  return (
    <div
      className="walk-touchlook"
      onPointerDown={(e) => {
        last.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const l = last.current;
        if (!l || l.id !== e.pointerId) return;
        onLook(e.clientX - l.x, e.clientY - l.y);
        last.current = { ...l, x: e.clientX, y: e.clientY };
      }}
      onPointerUp={() => (last.current = null)}
      onPointerCancel={() => (last.current = null)}
    />
  );
}
