// @vitest-environment jsdom
// Renders every part from four sides into an HTML contact sheet (for eyeballing the figures).
// Run: npx vitest run --config scripts/vitest.sheet.config.ts
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { P, inkScale, setCam, setFrame, filterFor, f } from '../src/figures/engine/core.js';
import { DRAWERS } from '../src/figures';
import { getDef } from '../src/sim/components/registry';
import { PITCH } from '../src/figures/scene';
import { drawEsp32Doit } from '../src/figures/parts/esp32Doit';

const visuals: Record<string, Record<string, unknown>> = {
  led: { brightness: 0.8 }, rgb: { r: 0.9, g: 0.2, b: 0.6 }, servo: { angle: 30 }, dcmotor: { angle: 40, rpm: 80 },
  'buzzer-active': { sounding: true, hz: 2300 }, pir: { out: true, powered: true }, pot: { position: 0.7 }, ldr: { lux: 300 },
  st7735: { powered: false }, l298n: { powered: true },
};

it('writes the contact sheet', () => {
  const out: string[] = [];
  for (const type of Object.keys(DRAWERS)) {
    const def = getDef(type);
    const cells: string[] = [];
    for (const yaw of [45, 135, 225, 315]) {
      setFrame({ ox: 0, oy: 0, rc: [0, 0], rcz: 0, inkK: 0.12 });
      setCam(yaw, PITCH);
      const d = DRAWERS[type]({ partId: type, params: { ...def.defaults }, visual: visuals[type] ?? {}, hot: {} });
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const x of [def.bounds[0][0], def.bounds[1][0]]) for (const y of [def.bounds[0][1], def.bounds[1][1]]) for (const z of [0, def.bounds[1][2]]) {
        const [X, Y] = P(x, y, z); x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y);
      }
      const pad = 6;
      cells.push(`<svg viewBox="${f(x0 - pad)} ${f(y0 - pad)} ${f(x1 - x0 + 2 * pad)} ${f(y1 - y0 + 2 * pad)}"><defs>${filterFor(0.12)}</defs><g filter="url(#hand)">${inkScale(d.shadow + d.body)}</g>${d.overlay}</svg>`);
    }
    out.push(`<section><h2>${type}</h2><div class="row">${cells.join('')}</div></section>`);
  }
  setCam(315, PITCH);
  setFrame({ ox: 0, oy: 0, rc: [0, 0], rcz: 0, inkK: 0.12 });
  writeFileSync(process.env.SHEET_OUT ?? 'contact-sheet.html', `<!doctype html><meta charset="utf-8"><style>body{background:#f2efe7;font:12px monospace;margin:10px}.row{display:flex;gap:6px}svg{width:340px;height:240px;background:#f7f4ec;border:1px solid #ddd}h2{margin:6px 0 2px;font-size:13px}</style>${out.join('')}`);
});
