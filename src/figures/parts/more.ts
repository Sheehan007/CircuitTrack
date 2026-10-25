// Stage-2 figures: BME280, ST7735 TFT, SG90 servo, TT motor, L298N, battery pack, buzzers, potentiometer, LDR, PIR,
// RGB LED. Same conventions as the rest: Colorfigures primitives, every separate piece boxed and depth-sorted, pins
// taken from the component definitions so the drawing and the simulator agree.
import {
  box, cyl, Dv, cylX, fill, hullInk, ink, loft, matOf, METAL, mix, on, P, pd, PZ, rod, ellUV, toneI, tx, vis, type Mat, type V3,
} from '../engine/core.js';
import { boxShadow, glow, GOLD, PCB_GREEN, ringShadow, SILK, slab, sortSvg, TIN, txZ, disc, type Sortable } from '../lib';
import { headerRow } from './modules';
import { terminalTarget } from './terminals';
import type { PartDrawer } from './types';
import { getDef } from '../../sim/components/registry';
import { BB, RAILS } from '../../sim/components/breadboard';

const pinsOf = (type: string) => getDef(type).terminals.map((t) => ({ id: t.id, label: t.label, at: t.pos }));
const B = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): [V3, V3] => [[x0, y0, z0], [x1, y1, z1]];
const PURPLE: Mat = { l: '#8a5cc7', m: '#6c43a6', d: '#3b2160' };
const PCB_RED: Mat = { l: '#d8564a', m: '#b63e33', d: '#6b211b' };
const BLUE_PLASTIC: Mat = { l: '#5b8fe0', m: '#3f70c4', d: '#203d73' };
const YELLOW: Mat = { l: '#ffd23f', m: '#e6b522', d: '#7a5d0a' };
const BLACK: Mat = { l: '#4a4642', m: '#2f2c29', d: '#181614' };
const SCREW: Mat = { l: '#3d8fe0', m: '#2b6fb7', d: '#173f69' };
const WHITE: Mat = { l: '#fbfaf3', m: '#e3e0d2', d: '#bdb8a6' };

/** Paint an RGBA framebuffer onto a horizontal rectangle (rows along +x, columns along −y) with an affine image. */
const imgCache = new WeakMap<Uint8ClampedArray, { frame: number; url: string }>();
function framebufferImage(px: Uint8ClampedArray, frame: number, w: number, h: number) {
  const c = imgCache.get(px);
  if (c && c.frame === frame) return c.url;
  if (typeof document === 'undefined') return '';
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  if (!g) return '';
  const img = g.createImageData(w, h);
  img.data.set(px);
  g.putImageData(img, 0, 0);
  const url = cv.toDataURL('image/png');
  imgCache.set(px, { frame, url });
  return url;
}

/* ---------------- BME280 breakout ---------------- */
export const drawBme280: PartDrawer = ({ partId, hot }) => {
  const z0 = 1.4, z1 = 3.0;
  let pcb = slab(-7.4, -7.6, 7.4, 7.6, z0, z1, 1, PURPLE, 1.7);
  pcb += disc(4.5, 5.3, z1 + 0.01, 1.1, '#e9e3d2') + disc(4.5, -5.3, z1 + 0.01, 1.1, '#e9e3d2');
  pcb += txZ(2.2, 0, z1 + 0.02, 'BME280', 1.0, SILK, 800, 'y');
  for (const t of getDef('bme280').terminals) pcb += txZ(-3.6, t.pos[1], z1 + 0.02, t.id, 0.6, SILK, 800, 'y');
  const sensor = box(4.2, -1.3, z1, 6.7, 1.3, z1 + 0.9, METAL, toneI, 0.7) + disc(5.45, 0.6, z1 + 0.91, 0.25, '#3a3632');
  const items: Sortable[] = [
    { box: B(-7.4, -7.6, z0, 7.4, 7.6, z1), svg: pcb },
    { box: B(4.2, -1.3, z1, 6.7, 1.3, z1 + 0.9), svg: sensor },
    ...headerRow(pinsOf('bme280'), z1, partId, hot),
  ];
  return { body: sortSvg(items), overlay: '', shadow: boxShadow(-7.4, -7.6, 7.4, 7.6, 3) };
};

/* ---------------- ST7735 1.8" TFT: 160 rows along +x, 128 columns along −y ---------------- */
const TFT_ACT = { x0: -16.0, y0: 14.0, ph: 35.04 / 160, pw: -28.03 / 128 };
export const drawTft: PartDrawer = ({ partId, visual, hot }) => {
  const z0 = 1.4, z1 = 3.0, gz = z1 + 1.6;
  let pcb = slab(-28.5, -17.2, 28.5, 17.2, z0, z1, 1.2, PCB_RED, 2.0);
  for (const [x, y] of [[-26.5, 15], [26.5, 15], [-26.5, -15], [26.5, -15]]) pcb += disc(x, y, z1 + 0.01, 1.3, '#e9e3d2', 0.5);
  for (const t of getDef('st7735').terminals) pcb += txZ(-23.3, t.pos[1], z1 + 0.02, t.id, 0.75, SILK, 800, 'y');
  pcb += txZ(24, 0, z1 + 0.02, '1.8 TFT SPI 128x160', 1.0, SILK, 800, 'y');
  let glass = box(-20, -16, z1, 21.5, 16, gz, { l: '#2a2f36', m: '#1d2128', d: '#101318' }, toneI, 1.5);
  const ax1 = TFT_ACT.x0 + 160 * TFT_ACT.ph, ay1 = TFT_ACT.y0 + 128 * TFT_ACT.pw;
  glass += `<path d="${pd([[TFT_ACT.x0, TFT_ACT.y0, gz + 0.01], [ax1, TFT_ACT.y0, gz + 0.01], [ax1, ay1, gz + 0.01], [TFT_ACT.x0, ay1, gz + 0.01]])}" fill="#07080a"/>`;
  const items: Sortable[] = [
    { box: B(-28.5, -17.2, z0, 28.5, 17.2, z1), svg: pcb },
    { box: B(-20, -16, z1, 21.5, 16, gz), svg: glass },
    ...headerRow(pinsOf('st7735'), z1, partId, hot),
  ];
  let overlay = '';
  const px = visual.pixels as Uint8ClampedArray | undefined;
  const bl = Number(visual.backlight ?? 0);
  if (visual.powered && px) {
    const url = framebufferImage(px, Number(visual.frame ?? 0), 128, 160);
    if (url) {
      // image x = column (−y), image y = row (+x)
      const O = P(TFT_ACT.x0, TFT_ACT.y0, gz + 0.03), U = P(TFT_ACT.x0, TFT_ACT.y0 + TFT_ACT.pw, gz + 0.03), V = P(TFT_ACT.x0 + TFT_ACT.ph, TFT_ACT.y0, gz + 0.03);
      const m = [U[0] - O[0], U[1] - O[1], V[0] - O[0], V[1] - O[1], O[0], O[1]].map((v) => v.toFixed(4)).join(' ');
      overlay = `<image href="${url}" width="128" height="160" transform="matrix(${m})" style="image-rendering:pixelated" preserveAspectRatio="none" opacity="${(0.15 + 0.85 * bl).toFixed(2)}" pointer-events="none"/>`;
    }
  }
  return { body: sortSvg(items), overlay, shadow: boxShadow(-28.5, -17.2, 28.5, 17.2, 4.6) };
};

/* ---------------- SG90 servo: body upright, shaft at (5.5, 0), lead to a 3-pin plug at x = −24 ---------------- */
function hornShape(kind: string, deg: number, z: number): { pts: V3[]; stripes?: V3[][] } {
  const cx = 5.5, cy = 0;
  // 0° points along +y (viewer-left at the default view); 180° along −y
  const a = ((deg - 90) * Math.PI) / 180;
  const ux = Math.sin(a), uy = Math.cos(a), vx = -uy, vy = ux;
  const L = kind === 'gate' ? 38 : kind === 'pointer' ? 24 : 15;
  const w0 = kind === 'gate' ? 2.2 : 3.2, w1 = kind === 'pointer' ? 0.6 : kind === 'gate' ? 2.2 : 1.8;
  const pt = (s: number, t: number): V3 => [cx + ux * s + vx * t, cy + uy * s + vy * t, z];
  const pts: V3[] = [pt(-4, -w0), pt(L, -w1), pt(L + (kind === 'pointer' ? 2.5 : 0.8), 0), pt(L, w1), pt(-4, w0)];
  const stripes = kind === 'gate' ? [8, 18, 28].map((s) => [pt(s, -w0), pt(s + 5, -w0), pt(s + 5, w0), pt(s, w0)]) : undefined;
  return { pts, stripes };
}

export const drawServo: PartDrawer = ({ partId, params, visual, hot }) => {
  const angle = Number(visual.angle ?? 90);
  const bz = 22.7, tabZ0 = 15.6, tabZ1 = 18;
  let body = box(-11.4, -6.1, 0, 11.4, 6.1, bz, BLUE_PLASTIC, toneI, 1.8);
  body += tx(11.45, 0, 9, 'SG90', 2.4, '#e9f1ff', 800) + tx(11.45, 0, 5.5, 'micro servo', 1.2, '#cfe0ff', 700);
  const tabs = box(-16.2, -6.1, tabZ0, 16.2, 6.1, tabZ1, BLUE_PLASTIC, toneI, 1.4) + disc(-14, 0, tabZ1 + 0.01, 1, '#203d73') + disc(14, 0, tabZ1 + 0.01, 1, '#203d73');
  const tower = cyl(5.5, 0, bz, bz + 3.6, 5.9, BLUE_PLASTIC, toneI, 1.4, 22) + cyl(-1.8, 0, bz, bz + 1.6, 3.2, BLUE_PLASTIC, toneI, 1.0, 16);
  const shaft = cyl(5.5, 0, bz + 3.6, bz + 5.2, 2.3, WHITE, toneI, 1.0, 14);
  const h = hornShape(String(params.horn ?? 'arm'), angle, bz + 5.2);
  const top = h.pts.map((p) => [p[0], p[1], p[2] + 1.6] as V3);
  let horn = loft(h.pts, top, (n) => toneI(n, WHITE)) + fill(pd(top), WHITE.l) + hullInk([...h.pts, ...top], 1.3);
  if (h.stripes) for (const s of h.stripes) horn += fill(pd(s.map((p) => [p[0], p[1], p[2] + 1.62] as V3)), '#e2483d');
  horn += disc(5.5, 0, bz + 6.83, 0.9, '#bdb8a6', 0.5);
  // the lead: brown, red, orange, from the body's −x side to the plug
  const lead = ([['#6b4423', 2.54], ['#e2483d', 0], ['#f08a24', -2.54]] as const).map(([c, y]) => rod([-11.4, y * 0.35, 3], [-22.7, y, 3.2], 0.55, matOf(c), toneI, 0.5)).join('');
  const plug = box(-25.3, -3.9, 0, -22.7, 3.9, 6.6, BLACK, toneI, 1.2);
  const pins = pinsOf('servo').map((p) => ({
    box: B(p.at[0] - 1, p.at[1] - 1, 6.6, p.at[0] + 1, p.at[1] + 1, p.at[2]),
    svg: box(p.at[0] - 0.32, p.at[1] - 0.32, 6.6, p.at[0] + 0.32, p.at[1] + 0.32, p.at[2], GOLD, toneI, 0.6) + terminalTarget(partId, p.id, p.label, p.at, hot[p.id]),
  }));
  const hx = h.pts.map((p) => p[0]), hy = h.pts.map((p) => p[1]);
  const items: Sortable[] = [
    { box: B(-11.4, -6.1, 0, 11.4, 6.1, tabZ0), svg: body },
    { box: B(-16.2, -6.1, tabZ0, 16.2, 6.1, tabZ1), svg: tabs },
    { box: B(-5, -5.9, bz, 11.4, 5.9, bz + 3.6), svg: tower },
    { box: B(3.2, -2.3, bz + 3.6, 7.8, 2.3, bz + 5.2), svg: shaft },
    { box: B(Math.min(...hx), Math.min(...hy), bz + 5.2, Math.max(...hx), Math.max(...hy), bz + 6.8), svg: horn },
    { box: B(-22.7, -2.6, 2.6, -11.4, 2.6, 3.8), svg: lead },
    { box: B(-25.3, -3.9, 0, -22.7, 3.9, 6.6), svg: plug },
    ...pins,
  ];
  const shadow = boxShadow(-11.4, -6.1, 11.4, 6.1, bz + 4) + boxShadow(-25.3, -3.9, -22.7, 3.9, 6.6);
  return { body: sortSvg(items), overlay: visual.moving ? glow([5.5, 0, bz + 6], '#ffffff', 0.25, 4) : '', shadow };
};

/* ---------------- TT gear motor: gearbox, motor can, shaft along y at x = −10, plug at x = 55 ---------------- */
export const drawMotor: PartDrawer = ({ partId, params, visual, hot }) => {
  const zc = 12, ang = (Number(visual.angle ?? 0) * Math.PI) / 180;
  const gear = box(-18, -11.25, 2.6, 19, 11.25, 21.4, YELLOW, toneI, 1.8) + tx(19.05, 0, 13, 'TT 1:48', 2.0, '#7a5d0a', 800);
  const feet = box(-16, -9, 0, -12, 9, 2.6, YELLOW, toneI, 1) + box(13, -9, 0, 17, 9, 2.6, YELLOW, toneI, 1);
  const can = cylX(19, 44, 0, zc, 9.5, METAL, toneI, 1.6, 22) + cylX(44, 45.5, 0, zc, 7.5, BLACK, toneI, 1.0, 18);
  const wires = rod([45.5, 2.2, zc + 3], [55, 1.27, 6.6], 0.6, matOf('#e2483d'), toneI, 0.5) + rod([45.5, -2.2, zc + 3], [55, -1.27, 6.6], 0.6, matOf('#2b2724'), toneI, 0.5);
  const plug = box(53.7, -2.6, 0, 56.3, 2.6, 6.6, BLACK, toneI, 1.1);
  const pins = pinsOf('dcmotor').map((p) => ({
    box: B(p.at[0] - 1, p.at[1] - 1, 6.6, p.at[0] + 1, p.at[1] + 1, p.at[2]),
    svg: box(p.at[0] - 0.32, p.at[1] - 0.32, 6.6, p.at[0] + 0.32, p.at[1] + 0.32, p.at[2], GOLD, toneI, 0.6) + terminalTarget(partId, p.id, p.label, p.at, hot[p.id]),
  }));
  const shaft = rod([-10, -11.25, zc], [-10, -14.5, zc], 2.7, WHITE, toneI, 0.9) + rod([-10, 11.25, zc], [-10, 13, zc], 2.7, WHITE, toneI, 0.9);
  let att = '';
  let attBox: [V3, V3];
  if (params.attachment === 'fan') {
    const yf = -15.5;
    for (let k = 0; k < 3; k++) {
      const a = ang + (k * 2 * Math.PI) / 3;
      const blade: V3[] = [0, 0.35, 0.7, 1].map((t, i) => [-10 + Math.cos(a + (i ? 0.45 * t : 0)) * (i ? 11 * (0.4 + 0.6 * t) : 2.5), yf, zc + Math.sin(a + (i ? 0.45 * t : 0)) * (i ? 11 * (0.4 + 0.6 * t) : 2.5)]);
      const blade2: V3[] = [...blade, [-10 + Math.cos(a - 0.3) * 6, yf, zc + Math.sin(a - 0.3) * 6]];
      att += fill(pd(blade2), '#8fd3ff') + ink(pd(blade2), 1.0);
    }
    att += rod([-10, -14.5, zc], [-10, -16.5, zc], 2.4, BLACK, toneI, 0.9);
    attBox = B(-21, -16.5, 0.5, 1, -14.5, 23.5);
  } else {
    const tyre = rod([-10, -14.5, zc], [-10, -22, zc], 11.5, BLACK, toneI, 1.4, 11.5, 28);
    const hubFace = -22.05;
    let spokes = '';
    for (let k = 0; k < 5; k++) {
      const a = ang + (k * 2 * Math.PI) / 5;
      spokes += `<path d="${pd([[-10, hubFace, zc], [-10 + Math.cos(a) * 8.5, hubFace, zc + Math.sin(a) * 8.5]], false)}" stroke="#ffd23f" stroke-width="1.8" stroke-linecap="round" fill="none"/>`;
    }
    const hub = `<path d="${pd(Array.from({ length: 24 }, (_, i) => [-10 + Math.cos((i / 24) * 6.283) * 9, hubFace, zc + Math.sin((i / 24) * 6.283) * 9] as V3))}" fill="#e6b522" stroke="#231e16" stroke-width=".8"/>`;
    // the hub and spokes sit on the outer face: only draw them when that face looks at the viewer
    att = tyre + (vis([0, -1, 0]) ? hub + spokes : '');
    attBox = B(-21.5, -22, 0.5, 1.5, -14.5, 23.5);
  }
  const items: Sortable[] = [
    { box: B(-18, -9, 0, 17, 9, 2.6), svg: feet },
    { box: B(-18, -11.25, 2.6, 19, 11.25, 21.4), svg: gear },
    { box: B(19, -9.5, zc - 9.5, 45.5, 9.5, zc + 9.5), svg: can },
    { box: B(-12.7, -14.5, zc - 2.7, -7.3, -11.25, zc + 2.7), svg: shaft },
    { box: attBox, svg: att },
    { box: B(45.5, -2.8, 6.6, 55, 2.8, zc + 3.6), svg: wires },
    { box: B(53.7, -2.6, 0, 56.3, 2.6, 6.6), svg: plug },
    ...pins,
  ];
  const shadow = boxShadow(-18, -11.25, 45.5, 11.25, 21.4) + boxShadow(-21.5, -22, 1.5, -11, 23.5);
  return { body: sortSvg(items), overlay: '', shadow };
};


/* ---------------- L298N module ---------------- */
export const drawL298n: PartDrawer = ({ partId, visual, hot }) => {
  const z0 = 1.4, z1 = 3.0;
  let pcb = slab(-21.5, -21.5, 21.5, 21.5, z0, z1, 1.4, PCB_RED, 2.0);
  for (const [x, y] of [[-19, -19], [-19, 19], [19, -19], [19, 19]]) pcb += disc(x, y, z1 + 0.01, 1.4, '#e9e3d2', 0.5);
  pcb += txZ(-6.5, 16, z1 + 0.02, 'OUT1 OUT2', 0.9, SILK, 800, 'x') + txZ(-6.5, -16, z1 + 0.02, 'OUT3 OUT4', 0.9, SILK, 800, 'x');
  pcb += txZ(14.6, 8, z1 + 0.02, '12V GND 5V', 0.85, SILK, 800, 'y') + txZ(16.4, -9.3, z1 + 0.02, 'ENA IN1 IN2 IN3 IN4 ENB', 0.75, SILK, 800, 'y');
  pcb += txZ(3, 0, z1 + 0.02, 'L298N', 1.4, SILK, 800, 'y');
  // heatsink with fins, the L298 in front of it
  let sink = box(-16, -10, z1, -2, 10, 26, BLACK, toneI, 1.6);
  for (let k = 1; k < 7; k++) { const x = -16 + k * 2; sink += `<path d="${pd([[x, 10.02, z1 + 1], [x, 10.02, 25.5]], false)}" stroke="#141210" stroke-width=".9" fill="none"/>`; }
  const chip = box(-1.9, -8, z1, 0.6, 8, 16, BLACK, toneI, 1.2);
  const reg = box(9, -3, z1, 12.5, 3, z1 + 3.5, BLACK, toneI, 1) + box(8, -2.5, z1, 9, 2.5, z1 + 0.6, METAL, toneI, 0.5);
  const led = box(13, 15.5, z1, 14.4, 16.4, z1 + 0.6, { l: visual.powered ? '#ff8a7a' : '#f1d8d3', m: '#d8b3ab', d: '#a8857d' }, toneI, 0.5);
  const screwBlock = (x0: number, y0: number, x1: number, y1: number, screws: { id: string; label: string; at: V3 }[]) => {
    let s = box(x0, y0, z1, x1, y1, 10, SCREW, toneI, 1.3);
    for (const p of screws) s += disc(p.at[0], p.at[1], 10.01, 1.35, '#c8cfd1', 0.7) + `<path d="${pd([[p.at[0] - 1, p.at[1], 10.03], [p.at[0] + 1, p.at[1], 10.03]], false)}" stroke="#5d6569" stroke-width=".8"/>`;
    for (const p of screws) s += terminalTarget(partId, p.id, p.label, p.at, hot[p.id]);
    return s;
  };
  const pins = pinsOf('l298n');
  const by = (ids: string[]) => pins.filter((p) => ids.includes(p.id));
  const items: Sortable[] = [
    { box: B(-21.5, -21.5, z0, 21.5, 21.5, z1), svg: pcb },
    { box: B(-16, -10, z1, -2, 10, 26), svg: sink },
    { box: B(-1.9, -8, z1, 0.6, 8, 16), svg: chip },
    { box: B(4.8, 8.8, z1, 11.2, 15.2, z1 + 9), svg: cyl(8, 12, z1, z1 + 9, 3.2, BLACK, toneI, 1.2, 18) },
    { box: B(4.8, -15.2, z1, 11.2, -8.8, z1 + 9), svg: cyl(8, -12, z1, z1 + 9, 3.2, BLACK, toneI, 1.2, 18) },
    { box: B(8, -3, z1, 12.5, 3, z1 + 3.5), svg: reg },
    { box: B(13, 15.5, z1, 14.4, 16.4, z1 + 0.6), svg: led },
    { box: B(-12, 17, z1, -1, 21.3, 10), svg: screwBlock(-12, 17, -1, 21.3, by(['OUT1', 'OUT2'])) },
    { box: B(-12, -21.3, z1, -1, -17, 10), svg: screwBlock(-12, -21.3, -1, -17, by(['OUT3', 'OUT4'])) },
    { box: B(16.3, 0.5, z1, 21, 15.5, 10), svg: screwBlock(16.3, 0.5, 21, 15.5, by(['VS', 'GND', 'V5'])) },
    ...headerRow(by(['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB']), z1, partId, hot),
  ];
  return { body: sortSvg(items), overlay: visual.powered ? glow([13.7, 15.9, z1 + 0.6], '#ff4d3a', 0.5, 1.6) : '', shadow: boxShadow(-21.5, -21.5, 21.5, 21.5, 3) + boxShadow(-16, -10, -2, 10, 26) };
};

/* ---------------- battery pack ---------------- */
export const drawBattery: PartDrawer = ({ partId, params, hot }) => {
  const kind = String(params.kind ?? 'aa4');
  const tray = box(-31, -29, 0, 31, 29, 4, BLACK, toneI, 1.8);
  const cells: Sortable[] = [];
  const cellM: Mat = { l: '#5ab0ff', m: '#3a8de0', d: '#1b4d80' };
  if (kind === 'v9' || kind === 'v12') {
    const m = kind === 'v9' ? matOf('#3a3632') : matOf('#5d6569');
    cells.push({ box: B(-24, -13, 4, 24, 13, 17), svg: box(-24, -13, 4, 24, 13, 17, m, toneI, 1.6) + txZ(0, 0, 17.02, kind === 'v9' ? '9V' : '12V DC', 4, '#f4f1ea', 800, 'x') });
  } else {
    const n = kind === 'li2s' ? 2 : kind === 'aa3' ? 3 : 4;
    const r = kind === 'li2s' ? 9 : 6.6;
    const span = 58 - 2 * r;
    for (let k = 0; k < n; k++) {
      const y = -span / 2 + (span * k) / (n - 1);
      const m = kind === 'li2s' ? matOf('#2fb36b') : cellM;
      cells.push({ box: B(-26, y - r, 4, 26, y + r, 4 + 2 * r), svg: cylX(-25, 24, y, 4 + r, r, m, toneI, 1.2, 18) + cylX(24, 26, y, 4 + r, r * 0.35, METAL, toneI, 0.8, 12) });
    }
  }
  const leads = rod([31, 4, 3], [35, 1.27, 6.6], 0.6, matOf('#e2483d'), toneI, 0.5) + rod([31, -4, 3], [35, -1.27, 6.6], 0.6, matOf('#2b2724'), toneI, 0.5);
  const plug = box(33.7, -2.6, 0, 36.3, 2.6, 6.6, BLACK, toneI, 1.1);
  const pins = pinsOf('battery').map((p) => ({
    box: B(p.at[0] - 1, p.at[1] - 1, 6.6, p.at[0] + 1, p.at[1] + 1, p.at[2]),
    svg: box(p.at[0] - 0.32, p.at[1] - 0.32, 6.6, p.at[0] + 0.32, p.at[1] + 0.32, p.at[2], GOLD, toneI, 0.6) + terminalTarget(partId, p.id, p.label, p.at, hot[p.id]),
  }));
  const items: Sortable[] = [
    { box: B(-31, -29, 0, 31, 29, 4), svg: tray },
    ...cells,
    { box: B(31, -4, 2, 35, 4, 6.6), svg: leads },
    { box: B(33.7, -2.6, 0, 36.3, 2.6, 6.6), svg: plug },
    ...pins,
  ];
  return { body: sortSvg(items), overlay: '', shadow: boxShadow(-31, -29, 31, 29, 4 + (kind === 'li2s' ? 18 : 13.2)) };
};

/* ---------------- buzzers ---------------- */
const drawBuzzer = (active: boolean): PartDrawer => ({ partId, visual, hot }) => {
  const zb = 1.6, zt = 11;
  const legs = [
    { box: B(-0.4, 3.4, 0, 0.4, 4.2, zb), svg: rod([0, 3.81, 0.4], [0, 3.81, zb + 0.2], 0.3, TIN, toneI, 0.6) },
    { box: B(-0.4, -4.2, 0, 0.4, -3.4, zb), svg: rod([0, -3.81, 0.4], [0, -3.81, zb + 0.2], 0.3, TIN, toneI, 0.6) },
  ];
  let bodySvg = (active ? '' : cyl(0, 0, zb - 0.6, zb, 6.1, PCB_GREEN, toneI, 0.8, 24)) + cyl(0, 0, zb, zt, 6, BLACK, toneI, 1.6, 24);
  bodySvg += disc(0, 0, zt + 0.01, 1.2, '#141210', 0.5);
  if (active) bodySvg += disc(3.4, 0, zt + 0.01, 1.3, '#fbfaf3') + txZ(3.4, 0, zt + 0.02, '+', 1.6, '#231e16', 800);
  else bodySvg += txZ(0, -3.3, zt + 0.02, 'PASSIVE', 0.9, '#bdb8a6', 800, 'y');
  const body = sortSvg([...legs, { box: B(-6.1, -6.1, zb - 0.6, 6.1, 6.1, zt), svg: bodySvg }])
    + terminalTarget(partId, 'P', '+', [0, 3.81, 0.4], hot.P, 1.2) + terminalTarget(partId, 'N', '−', [0, -3.81, 0.4], hot.N, 1.2);
  let overlay = '';
  if (visual.sounding) {
    const [X, Y] = P(0, 0, zt + 2);
    const k = Math.hypot(...(Dv(1, 0, 0) as [number, number]));
    const n = Number(visual.hz) > 1500 ? 3 : 2;
    for (let i = 1; i <= n; i++) {
      const r = (4 + i * 3.2) * k;
      overlay += `<path d="M${(X - r).toFixed(1)} ${(Y - r * 0.2).toFixed(1)} A${r.toFixed(1)} ${(r * 0.8).toFixed(1)} 0 0 1 ${(X + r).toFixed(1)} ${(Y - r * 0.2).toFixed(1)}" fill="none" stroke="#231e16" stroke-width="${(0.9 * k).toFixed(2)}" stroke-linecap="round" opacity="${(0.85 - i * 0.2).toFixed(2)}" class="sound-wave"/>`;
    }
  }
  return { body, overlay, shadow: ringShadow(0, 0, 6, zt) };
};
export const drawBuzzerActive = drawBuzzer(true);
export const drawBuzzerPassive = drawBuzzer(false);

/* ---------------- potentiometer (knob) ---------------- */
export const drawPot: PartDrawer = ({ partId, visual, hot }) => {
  const pos = Number(visual.position ?? 0.5);
  const legs = pinsOf('pot').map((p) => ({ box: B(p.at[0] - 0.5, 3, 0, p.at[0] + 0.5, 4, 2), svg: rod([p.at[0], 3.5, 0.4], [p.at[0], 3.5, 2.0], 0.35, TIN, toneI, 0.6) }));
  const bodyM: Mat = { l: '#3f70c4', m: '#2f5793', d: '#1a3157' };
  const housing = box(-6, -5, 1.5, 6, 4.2, 8, bodyM, toneI, 1.5) + box(-6, -5, 8, 6, 4.2, 8.6, METAL, toneI, 1.0);
  const knob = cyl(0, -0.4, 8.6, 10, 2.5, METAL, toneI, 0.9, 16) + cyl(0, -0.4, 10, 17, 5.2, BLACK, toneI, 1.4, 24);
  // the white index line on the knob's top: −150° (0 %) to +150° (100 %)
  const a = ((-150 + 300 * pos) * Math.PI) / 180;
  const mark = `<path d="${pd([[0, -0.4, 17.02], [Math.sin(a) * 4.4, -0.4 + Math.cos(a) * 4.4, 17.02]], false)}" stroke="#fbfaf3" stroke-width="1.6" stroke-linecap="round"/>`;
  const items: Sortable[] = [...legs, { box: B(-6, -5, 1.5, 6, 4.2, 8.6), svg: housing }, { box: B(-5.2, -5.6, 8.6, 5.2, 4.8, 17), svg: knob + mark }];
  const body = sortSvg(items) + pinsOf('pot').map((p) => terminalTarget(partId, p.id, p.label, p.at, hot[p.id], 1.2)).join('');
  return { body, overlay: '', shadow: boxShadow(-6, -5, 6, 4.2, 8.6) + ringShadow(0, -0.4, 5.2, 17) };
};

/* ---------------- LDR ---------------- */
export const drawLdr: PartDrawer = ({ partId, visual, hot }) => {
  const lux = Number(visual.lux ?? 100);
  const legs = [
    { box: B(-0.4, 0.9, 0, 0.4, 1.7, 4), svg: rod([0, 1.27, 0.4], [0, 1.27, 4.2], 0.28, TIN, toneI, 0.6) },
    { box: B(-0.4, -1.7, 0, 0.4, -0.9, 4), svg: rod([0, -1.27, 0.4], [0, -1.27, 4.2], 0.28, TIN, toneI, 0.6) },
  ];
  let head = cyl(0, 0, 4.2, 6.2, 2.6, matOf('#efe4c4'), toneI, 1.1, 20);
  const zig: V3[] = [];
  for (let k = 0; k <= 8; k++) zig.push([-1.6 + (3.2 * k) / 8, (k % 2 ? 1 : -1) * 1.4, 6.22]);
  head += `<path d="${pd(zig, false)}" stroke="#c4561f" stroke-width="1.1" fill="none" stroke-linejoin="round"/>`;
  const body = sortSvg([...legs, { box: B(-2.6, -2.6, 4.2, 2.6, 2.6, 6.2), svg: head }]) + terminalTarget(partId, '1', 'Leg 1', [0, 1.27, 0.4], hot['1'], 1.1) + terminalTarget(partId, '2', 'Leg 2', [0, -1.27, 0.4], hot['2'], 1.1);
  // light falling on it, shown as a soft warm halo that grows with lux
  const k = Math.min(1, Math.log10(1 + lux) / 3.3);
  return { body, overlay: glow([0, 0, 7], '#ffe7a3', k * 0.8, 5), shadow: ringShadow(0, 0, 2.6, 6.2) };
};

/* ---------------- PIR HC-SR501 ---------------- */
export const drawPir: PartDrawer = ({ partId, visual, hot }) => {
  const z0 = 1.4, z1 = 3.0, cx = -3;
  let pcb = slab(-16.5, -12.5, 16.5, 12.5, z0, z1, 1.2, PCB_GREEN, 1.9);
  for (const t of getDef('pir').terminals) pcb += txZ(10.6, t.pos[1], z1 + 0.02, t.id === 'VCC' ? 'VCC' : t.id, 0.7, SILK, 800, 'y');
  const frame = box(cx - 11.5, -11.5, z1, cx + 11.5, 11.5, z1 + 2, WHITE, toneI, 1.3);
  const out = !!visual.out;
  const domeM: Mat = out ? { l: '#fff3c4', m: '#f1dfa2', d: '#c9b46c' } : WHITE;
  const rings: V3[][] = [];
  for (let i = 0; i <= 5; i++) { const a = (i / 5) * (Math.PI / 2); rings.push(on(PZ(z1 + 2 + 10.5 * Math.sin(a)), ellUV(cx, 0, Math.max(0.1, 10.5 * Math.cos(a)), Math.max(0.1, 10.5 * Math.cos(a)), 12))); }
  let dome = '';
  for (let i = 0; i < 5; i++) dome += loft(rings[i], rings[i + 1], (n) => toneI(n, domeM));
  dome += hullInk(rings.flat(), 1.5);
  const items: Sortable[] = [
    { box: B(-16.5, -12.5, z0, 16.5, 12.5, z1), svg: pcb },
    { box: B(cx - 11.5, -11.5, z1, cx + 11.5, 11.5, z1 + 2), svg: frame },
    { box: B(cx - 10.5, -10.5, z1 + 2, cx + 10.5, 10.5, z1 + 12.5), svg: dome },
    ...headerRow(pinsOf('pir'), z1, partId, hot),
  ];
  return { body: sortSvg(items), overlay: out ? glow([cx, 0, z1 + 9], '#ffcf5a', 0.45, 9) : '', shadow: boxShadow(-16.5, -12.5, 16.5, 12.5, 3) + ringShadow(cx, 0, 10.5, 15) };
};

/* ---------------- RGB LED: four legs along x ---------------- */
export const drawRgb: PartDrawer = ({ partId, visual, hot }) => {
  const r = Number(visual.r ?? 0), g = Number(visual.g ?? 0), b = Number(visual.b ?? 0);
  const total = Math.max(r, g, b);
  const hex = '#' + [r, g, b].map((v) => Math.round(255 * Math.min(1, v / (total || 1))).toString(16).padStart(2, '0')).join('');
  const base = WHITE;
  const lens: Mat = total > 0.02 ? { l: mix(hex, '#ffffff', 0.55), m: mix(hex, '#ffffff', 0.3), d: mix(hex, '#000000', 0.2) } : base;
  const zRim = 6.6, zBody = 7.6, zTop = 11.2, rad = 2.5;
  const legs = pinsOf('rgb').map((p) => ({
    box: B(p.at[0] - 0.4, -0.4, 0, p.at[0] + 0.4, 0.4, zRim),
    svg: rod([p.at[0], 0, 0.4], [p.at[0], 0, 3.6], 0.25, TIN, toneI, 0.6) + rod([p.at[0], 0, 3.6], [p.at[0] * 0.35, 0, zRim], 0.25, TIN, toneI, 0.6),
  }));
  let lamp = cyl(0, 0, zRim, zBody, 2.9, lens, toneI, 1.1, 20) + cyl(0, 0, zBody, zTop, rad, lens, toneI, 1.1, 20);
  const rings: V3[][] = [];
  for (let i = 0; i <= 5; i++) { const a = (i / 5) * (Math.PI / 2); rings.push(on(PZ(zTop + rad * Math.sin(a)), ellUV(0, 0, Math.max(0.05, rad * Math.cos(a)), Math.max(0.05, rad * Math.cos(a)), 20))); }
  for (let i = 0; i < 5; i++) lamp += loft(rings[i], rings[i + 1], (n) => toneI(n, lens));
  lamp += hullInk(rings.flat().concat(on(PZ(zBody), ellUV(0, 0, rad, rad, 20))), 1.2);
  const body = sortSvg([...legs, { box: B(-2.9, -2.9, zRim, 2.9, 2.9, zTop + rad), svg: lamp }]) + pinsOf('rgb').map((p) => terminalTarget(partId, p.id, p.label, p.at, hot[p.id], 1.0)).join('');
  return { body, overlay: glow([0, 0, zTop], hex, total, 7), shadow: ringShadow(0, 0, 2.9, zTop + rad) };
};


/* ---------------- half-size breadboard ---------------- */

export const drawBreadboard: PartDrawer = ({ partId, hot }) => {
  const top = BB.top, hx = BB.halfX, hy = BB.halfY;
  const BODY: Mat = { l: '#f7f5ef', m: '#e4e0d4', d: '#b9b3a2' };
  let s = slab(-hx, -hy, hx, hy, 0, top, 1.6, BODY, 2.0);
  // centre channel and the rail stripes
  s += fill(pd([[-hx + 1.5, -1.3, top + 0.01], [hx - 1.5, -1.3, top + 0.01], [hx - 1.5, 1.3, top + 0.01], [-hx + 1.5, 1.3, top + 0.01]]), '#d8d3c4');
  s += `<path d="${pd([[-hx + 1.5, -1.3, top + 0.02], [hx - 1.5, -1.3, top + 0.02]], false)} ${pd([[-hx + 1.5, 1.3, top + 0.02], [hx - 1.5, 1.3, top + 0.02]], false)}" stroke="#b9b3a2" stroke-width=".7" fill="none"/>`;
  for (const r of RAILS) {
    // stripes run just outside the outer rails and just inside the inner ones
    const outer = Math.abs(r.y) > 20;
    const y = r.y + Math.sign(r.y) * (outer ? 1.3 : -1.3);
    s += `<path d="${pd([[-hx + 3, y, top + 0.02], [hx - 3, y, top + 0.02]], false)}" stroke="${r.sign === '+' ? '#e2483d' : '#3f7be0'}" stroke-width="1.1" fill="none"/>`;
  }
  // holes: one path of small squares
  const hole = 0.55;
  let d = '';
  for (const t of getDef('breadboard').terminals) {
    const [x, y] = t.pos;
    d += pd([[x - hole, y - hole, top + 0.03], [x + hole, y - hole, top + 0.03], [x + hole, y + hole, top + 0.03], [x - hole, y + hole, top + 0.03]]);
  }
  s += `<path d="${d}" fill="#4a453d"/>`;
  // column numbers and row letters
  for (let c = 1; c <= 30; c += c === 1 ? 4 : 5) {
    const x = (c - 15.5) * BB.pitch;
    s += txZ(x, 16.1, top + 0.03, String(c), 1.1, '#8a8478', 800) + txZ(x, -16.1, top + 0.03, String(c), 1.1, '#8a8478', 800);
  }
  for (const [r, y] of [['a', 13.97], ['e', 3.81], ['f', -3.81], ['j', -13.97]] as const) s += txZ(-hx + 1.7, y, top + 0.03, r, 1.1, '#8a8478', 800) + txZ(hx - 1.7, y, top + 0.03, r, 1.1, '#8a8478', 800);
  // hit targets (and rings on wired/plugged holes)
  let targets = '';
  for (const t of getDef('breadboard').terminals) targets += terminalTarget(partId, t.id, t.label, t.pos, hot[t.id], 1.05);
  return { body: s + targets, overlay: '', shadow: boxShadow(-hx, -hy, hx, hy, top) };
};
