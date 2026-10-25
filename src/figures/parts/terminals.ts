import { act, Dv, f, P, pd, type V3 } from '../engine/core.js';

const ring = (x: number, y: number, z: number, r: number): V3[] =>
  Array.from({ length: 14 }, (_, i) => [x + r * Math.cos((i / 14) * Math.PI * 2), y + r * Math.sin((i / 14) * Math.PI * 2), z] as V3);

/** An invisible, generous hit target on a terminal tip, plus a coloured ring when it is "hot". */
export function terminalTarget(partId: string, term: string, label: string, at: V3, hot?: string, r = 1.5) {
  const [X, Y] = P(at[0], at[1], at[2]);
  const rr = r * Math.hypot(...(Dv(1, 0, 0) as [number, number]));
  const ringSvg = hot ? `<path d="${pd(ring(at[0], at[1], at[2] + 0.05, r * 0.75))}" fill="none" stroke="${hot}" stroke-width="1.6"/>` : '';
  return act('term', `${ringSvg}<circle cx="${f(X)}" cy="${f(Y)}" r="${f(rr)}" fill="#000" fill-opacity="0"/>`, `data-part="${partId}" data-term="${term}" data-label="${label}"`);
}
