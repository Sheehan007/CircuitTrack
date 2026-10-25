// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { P, setCam } from '../src/figures/engine/core.js';
import { composeScene, PITCH } from '../src/figures/scene';
import { DOIT_DEVKIT_V1 } from '../src/sim/boards/doitDevkitV1';
import { weatherStation, buttonLed } from '../src/content/templates';
import { boardItems } from '../src/figures/parts/esp32Doit';
import { depthSort } from '../src/figures/lib';

describe('figure geometry', () => {
  it('matches the real board: seen from the USB end with the antenna away, EN…VIN is on the left', () => {
    setCam(0, PITCH); // viewer on the +x (USB) side looking toward the antenna
    const en = DOIT_DEVKIT_V1.pins.find((p) => p.id === 'EN')!.pos;
    const d23 = DOIT_DEVKIT_V1.pins.find((p) => p.id === 'GPIO23')!.pos;
    expect(P(...en)[0]).toBeLessThan(P(...d23)[0]);
  });

  it('draws every terminal where the wires attach, for every part rotation and view', () => {
    for (const make of [weatherStation, buttonLed]) {
      for (let rot = 0; rot < 4; rot++) {
        const p = make();
        p.parts.forEach((part) => { part.rot = rot; });
        for (const yaw of [45, 135, 225, 315]) {
          const scene = composeScene({ project: p, snap: null, yaw, unitsPerPx: 0.1, selection: null, hoverTerm: null, draft: null, labels: 'none', wobble: false });
          const host = document.createElement('div');
          host.innerHTML = `<svg>${scene.parts}</svg>`;
          for (const el of host.querySelectorAll<SVGElement>('[data-act="term"]')) {
            const c = el.querySelector('circle')!;
            const g = el.closest('[data-part-id]')!.getAttribute('transform')!;
            const [, tx, ty] = g.match(/translate\(([-\d.]+) ([-\d.]+)\)/)!.map(Number);
            const at = scene.terminals.get(`${el.dataset.part}:${el.dataset.term}`)!;
            expect(Math.abs(Number(c.getAttribute('cx')) + tx - at[0])).toBeLessThan(0.15);
            expect(Math.abs(Number(c.getAttribute('cy')) + ty - at[1])).toBeLessThan(0.15);
          }
        }
      }
    }
  });

  it('paints the board PCB before the module and each header strip before its pins, from every side', () => {
    for (const yaw of [45, 135, 225, 315]) {
      setCam(yaw, PITCH);
      const items = boardItems({ powered: true, led2: 0, enDown: false, bootDown: false }).map((it, i) => ({ ...it, svg: String(i) }));
      const order = depthSort(items).map((x) => Number(x.svg));
      const pcb = 30, module = 31, can = 32;
      expect(order.indexOf(pcb)).toBeLessThan(order.indexOf(module));
      expect(order.indexOf(module)).toBeLessThan(order.indexOf(can));
      for (const strip of [40, 56]) for (let k = 1; k <= 15; k++) expect(order.indexOf(strip)).toBeLessThan(order.indexOf(strip + k));
    }
  });
});
