// LED, resistor and tactile button, hand-inked with the Colorfigures engine.
import {
  act, box, cyl, cylX, fill, hullInk, loft, matOf, METAL, mix, on, pd, PZ, rod, ellUV, toneI, type V3,
} from '../engine/core.js';
import { LED_COLORS } from '../../sim/components/basic';
import { boxShadow, glow, HEADER, ringShadow, TIN } from '../lib';
import { sortSvg } from '../lib';
import { terminalTarget } from './terminals';
import type { PartDrawer } from './types';

const LEG: V3 = [0.25, 0, 0];

/* ---------------- LED (5 mm): legs at y = ±1.27, body above ---------------- */
export const drawLed: PartDrawer = ({ partId, params, visual, hot }) => {
  const col = LED_COLORS[params.color] ?? LED_COLORS.red;
  const k = Number(visual.brightness ?? 0);
  const base = matOf(mix(col.hex, '#ffffff', 0.25));
  const litM = { l: mix(col.hex, '#ffffff', 0.35 + 0.5 * k), m: mix(col.hex, '#ffffff', 0.15 + 0.45 * k), d: mix(col.hex, '#000000', 0.25 - 0.2 * k) };
  const m = k > 0.02 ? litM : base;
  const zRim = 6.6, zBody = 7.6, zTop = 11.2, r = 2.5;
  // legs: cathode straight, anode with a small kink (it is the longer leg on a real LED)
  const legs = [
    { box: [[-0.3, -1.6, 0], [0.3, -0.9, zRim]] as [V3, V3], svg: rod([0, -1.27, 0.4], [0, -1.27, 3.2], LEG[0], TIN, toneI, 0.6) + rod([0, -1.27, 3.2], [0, -0.85, 4.0], LEG[0], TIN, toneI, 0.6) + rod([0, -0.85, 4.0], [0, -0.85, zRim], LEG[0], TIN, toneI, 0.6) },
    { box: [[-0.3, 0.9, 0], [0.3, 1.6, zRim]] as [V3, V3], svg: rod([0, 1.27, 0.4], [0, 1.27, 4.0], LEG[0], TIN, toneI, 0.6) + rod([0, 1.27, 4.0], [0, 0.85, 4.6], LEG[0], TIN, toneI, 0.6) + rod([0, 0.85, 4.6], [0, 0.85, zRim], LEG[0], TIN, toneI, 0.6) },
  ];
  // rim with the flat on the cathode side, body, dome
  const rim = on(PZ(zRim), ellUV(0, 0, 2.9, 2.9, 20).map(([x, y]) => [x, Math.min(y, 2.45)] as [number, number]));
  const rimTop = on(PZ(zBody), ellUV(0, 0, 2.9, 2.9, 20).map(([x, y]) => [x, Math.min(y, 2.45)] as [number, number]));
  let lamp = loft(rim, rimTop, (n) => toneI(n, m)) + fill(pd(rimTop), m.l) + hullInk([...rim, ...rimTop], 1.1);
  lamp += cyl(0, 0, zBody, zTop, r, m, toneI, 1.1, 20);
  const rings: V3[][] = [];
  for (let i = 0; i <= 5; i++) {
    const a = (i / 5) * (Math.PI / 2);
    rings.push(on(PZ(zTop + r * Math.sin(a)), ellUV(0, 0, Math.max(0.05, r * Math.cos(a)), Math.max(0.05, r * Math.cos(a)), 20)));
  }
  for (let i = 0; i < 5; i++) lamp += loft(rings[i], rings[i + 1], (n) => toneI(n, m));
  lamp += hullInk(rings.flat().concat(on(PZ(zBody), ellUV(0, 0, r, r, 20))), 1.2);
  // a highlight streak on the lens
  lamp += `<path d="${pd([[1.2, -1.4, zTop + 1.4], [1.6, -0.9, zTop - 1.5]], false)}" stroke="#ffffff" stroke-width="0.9" opacity=".55" fill="none" stroke-linecap="round"/>`;
  const body = sortSvg([...legs, { box: [[-2.9, -2.9, zRim], [2.9, 2.9, zTop + r]], svg: lamp }])
    + terminalTarget(partId, 'A', 'Anode +', [0, -1.27, 0.4], hot.A)
    + terminalTarget(partId, 'K', 'Cathode −', [0, 1.27, 0.4], hot.K);
  const overlay = glow([0, 0, zTop], col.hex, k, 7) + (visual.over ? glow([0, 0, zTop], '#ffffff', 0.6, 3) : '');
  const shadow = ringShadow(0, 0, 2.9, zTop + r);
  return { body, overlay, shadow };
};

/* ---------------- resistor: axial, leads at x = ±5.08 ---------------- */
const BAND = ['#1b1b1b', '#7a4a21', '#d8332a', '#f07f1d', '#f5d327', '#2f9e44', '#2f63d8', '#7c3fb0', '#8a8a8a', '#f4f4f4'];
const GOLD_BAND = '#c9a43a';

export function bandsFor(ohms: number): string[] {
  const e = Math.floor(Math.log10(ohms)) - 1;
  const sig = Math.round(ohms / Math.pow(10, e));
  const d1 = Math.floor(sig / 10) % 10, d2 = sig % 10;
  return [BAND[d1], BAND[d2], BAND[Math.max(0, Math.min(9, e))], GOLD_BAND];
}

export const drawResistor: PartDrawer = ({ partId, params, hot }) => {
  const ohms = Number(params.ohms) || 220;
  const z = 3.0, x0 = -3.2, x1 = 3.2, r = 1.15;
  const BODY = { l: '#efd9a8', m: '#d9bd84', d: '#a8885a' };
  const lead = (x: number, s: number) => rod([x, 0, 0.4], [x, 0, z], 0.25, TIN, toneI, 0.6) + rod([x, 0, z], [x - s * 1.6, 0, z], 0.25, TIN, toneI, 0.6);
  let bodySvg = cylX(x0, x1, 0, z, r, BODY, toneI, 1.2, 18);
  const bands = bandsFor(ohms);
  const at = [-2.0, -1.1, -0.2, 1.9];
  bands.forEach((c, i) => { bodySvg += cylX(at[i] - 0.28, at[i] + 0.28, 0, z, r + 0.03, matOf(c), toneI, 0.5, 18); });
  bodySvg += cylX(x0 - 0.05, x0 + 0.7, 0, z, r + 0.15, BODY, toneI, 0.9, 18) + cylX(x1 - 0.7, x1 + 0.05, 0, z, r + 0.15, BODY, toneI, 0.9, 18);
  const body = sortSvg([
    { box: [[-5.4, -0.3, 0], [-3.2, 0.3, z]] as [V3, V3], svg: lead(-5.08, -1) },
    { box: [[3.2, -0.3, 0], [5.4, 0.3, z]] as [V3, V3], svg: lead(5.08, 1) },
    { box: [[x0, -r, z - r], [x1, r, z + r]] as [V3, V3], svg: bodySvg },
  ]) + terminalTarget(partId, '1', 'Lead 1', [-5.08, 0, 0.4], hot['1']) + terminalTarget(partId, '2', 'Lead 2', [5.08, 0, 0.4], hot['2']);
  const shadow = boxShadow(-5.2, -1.2, 5.2, 1.2, z + r);
  return { body, overlay: '', shadow };
};

/* ---------------- tactile button: legs at (±3.81, ±2.54) ---------------- */
const CAPS: Record<string, string> = { red: '#e2483d', black: '#3a3632', blue: '#3f7be0', yellow: '#f4c430' };

export const drawButton: PartDrawer = ({ partId, params, visual, hot }) => {
  const pressed = !!visual.pressed;
  const capM = matOf(CAPS[params.cap] ?? CAPS.red);
  const zb = 1.4, zt = 4.6, zp = 5.0, capTop = pressed ? 6.1 : 7.4;
  const legs = ([[-1, -1, '1a'], [1, -1, '1b'], [-1, 1, '2a'], [1, 1, '2b']] as const).map(([sx, sy]) => ({
    box: [[sx * 3.81 - 0.4, sy * 2.54 - 0.4, 0], [sx * 3.81 + 0.4, sy * 2.54 + 0.4, zb + 0.6]] as [V3, V3],
    svg: rod([sx * 3.81, sy * 2.54, 0.4], [sx * 3.81, sy * 2.54, zb + 0.4], 0.28, TIN, toneI, 0.6) + rod([sx * 3.81, sy * 2.54, zb + 0.4], [sx * 3.05, sy * 2.54, zb + 0.4], 0.28, TIN, toneI, 0.6),
  }));
  let top = box(-3, -3, zb, 3, 3, zt, HEADER, toneI, 1.3);
  top += box(-3.1, -3.1, zt, 3.1, 3.1, zp, METAL, toneI, 1.0);
  // the two internal strips (which legs are always joined), embossed on the metal plate
  top += `<path d="${pd([[-2.4, -2.1, zp + 0.01], [2.4, -2.1, zp + 0.01]], false)}" stroke="#8f989b" stroke-width=".7" fill="none"/>`
    + `<path d="${pd([[-2.4, 2.1, zp + 0.01], [2.4, 2.1, zp + 0.01]], false)}" stroke="#8f989b" stroke-width=".7" fill="none"/>`;
  const cap = act('press', cyl(0, 0, zp, capTop, 1.9, capM, toneI, 1.2, 20), `data-part="${partId}" data-target="pressed" role="button" aria-label="Press ${partId}"`);
  const body = sortSvg([...legs, { box: [[-3.1, -3.1, zb], [3.1, 3.1, capTop]], svg: top + cap }])
    + terminalTarget(partId, '1a', 'Leg 1a', [-3.81, -2.54, 0.4], hot['1a'], 1.2)
    + terminalTarget(partId, '1b', 'Leg 1b', [3.81, -2.54, 0.4], hot['1b'], 1.2)
    + terminalTarget(partId, '2a', 'Leg 2a', [-3.81, 2.54, 0.4], hot['2a'], 1.2)
    + terminalTarget(partId, '2b', 'Leg 2b', [3.81, 2.54, 0.4], hot['2b'], 1.2);
  const shadow = boxShadow(-3.1, -3.1, 3.1, 3.1, capTop);
  return { body, overlay: '', shadow };
};
