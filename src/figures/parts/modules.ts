// DHT22 / DHT11 and SSD1306 OLED breakout modules. Same conventions as the board: PCB resting on its solder joints,
// male header pins pointing up so jumper wires plug on from above.
import { box, fill, matOf, P, pd, toneI, type V3 } from '../engine/core.js';
import { boxShadow, GOLD, HEADER, PCB_BLUE, PCB_BLACK, SILK, slab, txZ, sortSvg, glow } from '../lib';
import { terminalTarget } from './terminals';
import { dht11, dht22, ssd1306 } from '../../sim/components/modules';
import type { PartDrawer } from './types';

const PIN_W = 0.32;

export function headerRow(pins: { id: string; label: string; at: V3 }[], z0: number, partId: string, hot: Record<string, string>) {
  const xs = pins.map((p) => p.at[0]), ys = pins.map((p) => p.at[1]);
  const strip = { box: [[Math.min(...xs) - 1.27, Math.min(...ys) - 1.27, z0], [Math.max(...xs) + 1.27, Math.max(...ys) + 1.27, z0 + 2.5]] as [V3, V3], svg: box(Math.min(...xs) - 1.27, Math.min(...ys) - 1.27, z0, Math.max(...xs) + 1.27, Math.max(...ys) + 1.27, z0 + 2.5, HEADER, toneI, 1.1) };
  const items = pins.map((p) => ({
    box: [[p.at[0] - 1.2, p.at[1] - 1.2, z0 + 2.5], [p.at[0] + 1.2, p.at[1] + 1.2, p.at[2]]] as [V3, V3],
    svg: box(p.at[0] - PIN_W, p.at[1] - PIN_W, z0 + 2.5, p.at[0] + PIN_W, p.at[1] + PIN_W, p.at[2], GOLD, toneI, 0.6) + terminalTarget(partId, p.id, p.label, p.at, hot[p.id]),
  }));
  return [strip, ...items];
}

/* ---------------- DHT22 (white) / DHT11 (blue) on a small module board ---------------- */
export const drawDht = (variant: 'DHT22' | 'DHT11'): PartDrawer => ({ partId, visual, hot }) => {
  const is22 = variant === 'DHT22';
  const pcbZ0 = 1.4, pcbZ1 = 3.0;
  const shell = is22 ? { l: '#fbfaf3', m: '#e3e0d2', d: '#bdb8a6' } : { l: '#7fb6e8', m: '#5d97cf', d: '#2f5d8a' };
  const bx0 = is22 ? -17 : -13, bx1 = 6.5, by = is22 ? 7.6 : 6.2, bz = pcbZ1 + (is22 ? 7.7 : 5.5);
  let body = box(bx0, -by, pcbZ1, bx1, by, bz, shell, toneI, 1.6);
  // ventilation grille on the top face: rows of slots
  let slots = '';
  for (let i = 0; i < (is22 ? 6 : 4); i++) {
    const x = bx0 + 2.4 + i * 3.1;
    for (const y0 of [-by + 1.6, 0.6]) {
      slots += fill(pd([[x, y0, bz + 0.01], [x + 1.7, y0, bz + 0.01], [x + 1.7, y0 + by - 2.2, bz + 0.01], [x, y0 + by - 2.2, bz + 0.01]]), shell.d);
    }
  }
  body += slots + txZ(bx0 + 2.2, 0, bz + 0.02, variant, 1.4, '#6f6a5e', 800, 'y');
  const pins = (variant === 'DHT22' ? dht22 : dht11).terminals.map((t) => ({ id: t.id, label: t.label, at: t.pos }));
  const pcbM = is22 ? matOf('#c8423b') : PCB_BLUE;
  let pcb = slab(-18, -8.5, 12, 8.5, pcbZ0, pcbZ1, 1, pcbM, 1.8);
  pcb += txZ(11.2, 2.54, pcbZ1 + 0.02, '+', 1.4, SILK, 800, 'x') + txZ(11.2, 0, pcbZ1 + 0.02, 'S', 1.2, SILK, 800, 'x') + txZ(11.2, -2.54, pcbZ1 + 0.02, '-', 1.4, SILK, 800, 'x');
  // the module's 10 kΩ pull-up and a power LED
  pcb += box(7.4, -5.1, pcbZ1, 9.2, -4.2, pcbZ1 + 0.5, PCB_BLACK, toneI, 0.5);
  const ledOn = !!visual.powered;
  pcb += box(7.4, 4.4, pcbZ1, 8.8, 5.2, pcbZ1 + 0.5, { l: ledOn ? '#ff8a7a' : '#f1d8d3', m: '#d8b3ab', d: '#a8857d' }, toneI, 0.5);
  const items = [
    { box: [[-18, -8.5, pcbZ0], [12, 8.5, pcbZ1]] as [V3, V3], svg: pcb },
    { box: [[bx0, -by, pcbZ1], [bx1, by, bz]] as [V3, V3], svg: body },
    ...headerRow(pins, pcbZ1, partId, hot),
  ];
  const shadow = boxShadow(-18, -8.5, 12, 8.5, bz);
  return { body: sortSvg(items), overlay: ledOn ? glow([8.1, 4.8, pcbZ1 + 0.5], '#ff4d3a', 0.5, 1.5) : '', shadow };
};

/* ---------------- SSD1306 0.96" OLED: header along y at x = -11, glass toward +x ---------------- */
const TINT: Record<string, [string, string]> = { white: ['#f4f8ff', '#f4f8ff'], blue: ['#7cc7ff', '#7cc7ff'], 'yellow-blue': ['#ffd84a', '#7cc7ff'] };

// active area 21.74 × 10.86 mm: 64 rows run along +x away from the header (the header edge is the top of the
// picture) and the 128 columns run along −y (the engine's projection is mirror-handed, so −y is the viewer's right)
const ACT = { x0: -4.4, y0: 10.87, ph: 10.86 / 64, pw: -21.74 / 128 };

/** Paint the 128×64 image into a PNG data URL (browser only). Cached on the pixel buffer + frame. */
const imgCache = new WeakMap<Uint8Array, { frame: number; tint: string; url: string }>();
function oledImage(pixels: Uint8Array, frame: number, tint: string): string {
  const c = imgCache.get(pixels);
  if (c && c.frame === frame && c.tint === tint) return c.url;
  if (typeof document === 'undefined') return '';
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 64;
  const g = cv.getContext('2d');
  if (!g) return '';
  const img = g.createImageData(128, 64);
  const [top, rest] = TINT[tint] ?? TINT.white;
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const A = rgb(top), Bc = rgb(rest);
  for (let i = 0; i < 128 * 64; i++) {
    if (!pixels[i]) continue;
    const row = Math.floor(i / 128), col = row < 16 ? A : Bc;
    img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2]; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const url = cv.toDataURL('image/png');
  imgCache.set(pixels, { frame, tint, url });
  return url;
}

export const drawOled: PartDrawer = ({ partId, params, visual, hot }) => {
  const z0 = 1.4, z1 = 3.0, gz = z1 + 1.5;
  let pcb = slab(-13.8, -13.6, 13.8, 13.6, z0, z1, 1.4, PCB_BLUE, 1.9);
  for (const [x, y] of [[-12, -12], [-12, 12], [12, -12], [12, 12]]) pcb += fill(pd(Array.from({ length: 12 }, (_, i) => [x + Math.cos(i / 12 * 6.283) * 1, y + Math.sin(i / 12 * 6.283) * 1, z1 + 0.01] as V3)), '#e9e3d2');
  for (const t of ssd1306.terminals) pcb += txZ(-12.6, t.pos[1], z1 + 0.02, t.id, 0.8, SILK, 800, 'y');
  const powered = !!visual.powered;
  let glass = box(-8.6, -13.2, z1, 11.6, 13.2, gz, { l: '#2a2f36', m: '#1d2128', d: '#101318' }, toneI, 1.4);
  // the flex cable folding round the bottom edge
  glass += box(11.6, -5, z1, 12.9, 5, z1 + 0.6, { l: '#d9a24b', m: '#b8822e', d: '#7a5418' }, toneI, 0.7);
  // a faint frame showing the active area
  const ax1 = ACT.x0 + 64 * ACT.ph, ay1 = ACT.y0 + 128 * ACT.pw;  // ay1 < y0: columns run toward −y
  glass += `<path d="${pd([[ACT.x0 - 0.3, ACT.y0 + 0.3, gz + 0.01], [ax1 + 0.3, ACT.y0 + 0.3, gz + 0.01], [ax1 + 0.3, ay1 - 0.3, gz + 0.01], [ACT.x0 - 0.3, ay1 - 0.3, gz + 0.01]])}" fill="#0b0d10" stroke="none"/>`;
  glass += `<path d="${pd([[-7.6, 9.8, gz + 0.02], [-3.8, 12.6, gz + 0.02]], false)}" stroke="#ffffff" stroke-width=".8" opacity=".25" fill="none"/>`;
  const pins = ssd1306.terminals.map((t) => ({ id: t.id, label: t.label, at: t.pos }));
  const items = [
    { box: [[-13.8, -13.6, z0], [13.8, 13.6, z1]] as [V3, V3], svg: pcb },
    { box: [[-8.6, -13.2, z1], [12.9, 13.2, gz]] as [V3, V3], svg: glass },
    ...headerRow(pins, z1, partId, hot),
  ];
  // pixels: an image mapped onto the glass plane with an affine transform (the projection is affine on a plane)
  let overlay = '';
  const pixels = visual.pixels as Uint8Array | undefined;
  if (powered && pixels) {
    const url = oledImage(pixels, Number(visual.frame ?? 0), String(params.tint ?? 'white'));
    if (url) {
      const O = P(ACT.x0, ACT.y0, gz + 0.03), U = P(ACT.x0, ACT.y0 + ACT.pw, gz + 0.03), Vv = P(ACT.x0 + ACT.ph, ACT.y0, gz + 0.03);
      const m = [U[0] - O[0], U[1] - O[1], Vv[0] - O[0], Vv[1] - O[1], O[0], O[1]].map((v) => v.toFixed(4)).join(' ');
      overlay = `<image href="${url}" width="128" height="64" transform="matrix(${m})" style="image-rendering:pixelated" preserveAspectRatio="none" pointer-events="none"/>`
        + `<path d="${pd([[ACT.x0, ACT.y0, gz + 0.04], [ax1, ACT.y0, gz + 0.04], [ax1, ay1, gz + 0.04], [ACT.x0, ay1, gz + 0.04]])}" fill="${TINT[params.tint]?.[1] ?? '#f4f8ff'}" opacity=".05" pointer-events="none"/>`;
    }
  }
  const shadow = boxShadow(-13.8, -13.6, 13.8, 13.6, gz);
  return { body: sortSvg(items), overlay, shadow };
};
