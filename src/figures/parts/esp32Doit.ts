// Hand-inked isometric figure of the DOIT ESP32 DevKit V1, drawn with the Colorfigures engine.
// Geometry comes from the board profile (pin positions, PCB size), so the drawing and the simulator can't disagree.
/*
  Parts list (board-local mm; x along the length, antenna at -x, USB at +x; y across, EN-side header at -y):
    PCB          51.45 × 28.33 × 1.6, black solder mask, four 3 mm mounting holes, resting on its solder joints
    Module       ESP-WROOM-32: 25.5 × 18 board, tinned shield can, PCB antenna meander at the -x end
    Headers      2 × 15 male pins (2.54 mm pitch), black plastic strips, pins up so jumpers plug on from above
    USB          micro-B receptacle at the +x edge
    Buttons      EN (reset, -y) and BOOT (GPIO0, +y) either side of the USB socket
    Chips        CP2102 USB-UART bridge (QFN), AMS1117-3.3 regulator (SOT-223)
    LEDs         red power LED, blue LED on GPIO2
    Silkscreen   pin names beside each pin, EN / BOOT, board name
*/
import {
  act, box, castShadow, cyl, Dv, f, fill, METAL, P, pd, shape, toneI, type Mat, type V3,
} from '../engine/core.js';
import { DOIT_DEVKIT_V1 } from '../../sim/boards/doitDevkitV1';
import { disc, glow, GOLD, HEADER, lit, PCB_BLACK, SHIELD, SILK, slab, txZ } from '../lib';
import { sortSvg } from '../lib';

export interface BoardVisual {
  powered: boolean;
  /** On-board blue LED (GPIO2), 0–1. */
  led2: number;
  enDown: boolean;
  bootDown: boolean;
  /** Pins to ring in the accent colour (hovered, selected, wire being drawn). */
  hot?: Record<string, string>;
  /** Show the silkscreen pin names. */
  silk?: boolean;
  /** Part id used in data attributes (the stage uses "esp32"). */
  partId?: string;
}

const B = DOIT_DEVKIT_V1;
const L2 = B.size.length / 2, W2 = B.size.width / 2;
const Z0 = B.pcbZ, Z1 = B.pcbZ + B.size.thickness;
const STRIP_TOP = Z1 + 2.5;
const PIN_W = 0.32;
const MOD = { x0: -25.2, x1: 0.3, y0: -9, y1: 9, z1: Z1 + 0.8 };
const CAN = { x0: -18.4, x1: -0.3, y0: -8.2, y1: 8.2, z1: MOD.z1 + 2.4 };
const USB = { x0: 21.4, x1: 26.1, y0: -3.8, y1: 3.8, z1: Z1 + 2.6 };
const BTN = { en: [21.2, 9.2] as [number, number], boot: [21.2, -9.2] as [number, number] };
const LED_PWR: V3 = [17.2, 5.8, Z1], LED_IO2: V3 = [17.2, -5.8, Z1];
const BLUE_LED = '#3d7bf2', RED_LED = '#ef4c3a';

export const BOARD_BOX: [V3, V3] = [[-L2, -W2, 0], [L2 + 0.4, W2, B.pinTipZ]];

const qfn = (x0: number, y0: number, x1: number, y1: number, m: Mat = HEADER) => box(x0, y0, Z1, x1, y1, Z1 + 0.9, m, toneI, 0.7);

function pcb(st: BoardVisual) {
  let s = slab(-L2, -W2, L2, W2, Z0, Z1, 1.2, PCB_BLACK, 2.2);
  // mounting holes with tinned rings
  for (const [x, y] of [[-L2 + 2.4, -W2 + 2.4], [-L2 + 2.4, W2 - 2.4], [L2 - 2.4, -W2 + 2.4], [L2 - 2.4, W2 - 2.4]]) {
    s += disc(x, y, Z1 + 0.01, 1.5, GOLD.m, 0.6) + disc(x, y, Z1 + 0.02, 0.95, '#1b1712', 0.5);
  }
  // a few traces from the module toward the USB end
  const tr = (pts: V3[]) => `<path d="${pd(pts, false)}" fill="none" stroke="#3b4352" stroke-width=".9" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += tr([[1, 4, Z1 + 0.01], [6, 4, Z1 + 0.01], [8, 2.5, Z1 + 0.01]]);
  s += tr([[1, -3, Z1 + 0.01], [3, -3, Z1 + 0.01], [3.5, -4, Z1 + 0.01]]);
  s += tr([[14, -1, Z1 + 0.01], [20, -1, Z1 + 0.01], [21.4, -1.5, Z1 + 0.01]]);
  // silkscreen
  if (st.silk !== false) {
    for (const p of B.pins) {
      const inward = p.pos[1] > 0 ? -1 : 1;
      s += txZ(p.pos[0], p.pos[1] + inward * 2.35, Z1 + 0.02, p.label, 0.95, SILK, 700, 'y');
    }
    s += txZ(BTN.en[0] - 3.4, BTN.en[1], Z1 + 0.02, 'EN', 1.1, SILK, 800);
    s += txZ(BTN.boot[0] - 3.4, BTN.boot[1], Z1 + 0.02, 'BOOT', 1.1, SILK, 800);
    s += txZ(9.5, 0, Z1 + 0.02, 'ESP32 DEVKIT V1', 1.25, SILK, 800, 'x');
    s += txZ(9.5, -2.1, Z1 + 0.02, 'DOIT', 1.1, SILK, 700, 'x');
  }
  return s;
}

function moduleWroom() {
  let s = slab(MOD.x0, MOD.y0, MOD.x1, MOD.y1, Z1, MOD.z1, 0.4, { l: '#2b3140', m: '#1f2430', d: '#12151c' }, 1.6);
  // PCB antenna meander at the -x end
  const z = MOD.z1 + 0.01, pts: V3[] = [];
  let y = -7.2;
  pts.push([-19.4, y, z]);
  for (let i = 0; i < 6; i++) {
    const x = i % 2 ? -19.4 : -24.2;
    pts.push([x, y, z]);
    y += 2.4;
    pts.push([x, y, z]);
  }
  s += `<path d="${pd(pts, false)}" fill="none" stroke="${GOLD.m}" stroke-width="1.1" stroke-linejoin="round"/>`;
  return s;
}

function shieldCan() {
  let s = box(CAN.x0, CAN.y0, MOD.z1, CAN.x1, CAN.y1, CAN.z1, SHIELD, toneI, 1.6);
  const z = CAN.z1 + 0.01;
  s += txZ(-9.5, 0, z, 'ESP-WROOM-32', 1.9, '#5d6569', 800, 'x');
  s += txZ(-9.5, 3.2, z, 'ESP32-D0WD  4MB', 1.1, '#7a8387', 700, 'x');
  s += txZ(-9.5, -3.4, z, 'Wi-Fi + BT', 1.1, '#7a8387', 700, 'x');
  return s;
}

function usb() {
  const { x0, x1, y0, y1, z1 } = USB;
  let s = box(x0, y0, Z1, x1, y1, z1, METAL, toneI, 1.4);
  // the socket opening on the +x face
  const mouth: V3[] = [[x1 + 0.01, y0 + 0.6, Z1 + 0.5], [x1 + 0.01, y1 - 0.6, Z1 + 0.5], [x1 + 0.01, y1 - 1.1, z1 - 0.5], [x1 + 0.01, y0 + 1.1, z1 - 0.5]];
  s += shape(mouth, '#2a2622', 0.7);
  return s;
}

function button(cx: number, cy: number, down: boolean, name: 'EN' | 'BOOT', partId: string) {
  const top = Z1 + 1.4;
  let s = box(cx - 1.9, cy - 2.6, Z1, cx + 1.9, cy + 2.6, top, METAL, toneI, 1);
  const capTop = down ? top + 0.35 : top + 1.1;
  s += cyl(cx, cy, top, capTop, 1.15, HEADER, toneI, 0.9, 16);
  return act('press', s, `data-part="${partId}" data-target="${name}" role="button" tabindex="-1" aria-label="${name} button"`);
}

function smdLed(at: V3, color: string, k: number) {
  const body = lit(color, k * 0.9);
  return box(at[0] - 0.8, at[1] - 0.45, Z1, at[0] + 0.8, at[1] + 0.45, Z1 + 0.6, { l: lit('#f4efe2', 0), m: '#d8d2c2', d: '#a8a191' }, toneI, 0.5)
    + fill(pd([[at[0] - 0.6, at[1] - 0.35, Z1 + 0.61], [at[0] + 0.6, at[1] - 0.35, Z1 + 0.61], [at[0] + 0.6, at[1] + 0.35, Z1 + 0.61], [at[0] - 0.6, at[1] + 0.35, Z1 + 0.61]]), body);
}

function headerStrip(side: 'left' | 'right') {
  const ps = B.pins.filter((p) => p.side === side);
  const y = ps[0].pos[1];
  return box(ps[0].pos[0] - 1.27, y - 1.27, Z1, ps[ps.length - 1].pos[0] + 1.27, y + 1.27, STRIP_TOP, HEADER, toneI, 1.2);
}

function pin(p: (typeof B.pins)[number], partId: string, hot?: string) {
  const [x, y, tip] = p.pos;
  let s = box(x - PIN_W, y - PIN_W, STRIP_TOP, x + PIN_W, y + PIN_W, tip, GOLD, toneI, 0.6);
  if (hot) s += `<path d="${pd(ring(x, y, tip + 0.05, 1.1))}" fill="none" stroke="${hot}" stroke-width="1.6"/>`;
  // a generous, invisible hit target around the tip
  const [X, Y] = P(x, y, tip);
  s += `<circle cx="${f(X)}" cy="${f(Y)}" r="${f(1.6 * Math.hypot(...Dv(1, 0, 0)))}" fill="#000" fill-opacity="0"/>`;
  return act('term', s, `data-part="${partId}" data-term="${p.id}" data-label="${p.label}"`);
}

const ring = (x: number, y: number, z: number, r: number): V3[] =>
  Array.from({ length: 14 }, (_, i) => [x + r * Math.cos((i / 14) * Math.PI * 2), y + r * Math.sin((i / 14) * Math.PI * 2), z] as V3);

function stubs() {
  return B.pins.map((p) => ({
    box: [[p.pos[0] - 0.5, p.pos[1] - 0.5, 0], [p.pos[0] + 0.5, p.pos[1] + 0.5, Z0]] as [V3, V3],
    svg: box(p.pos[0] - 0.5, p.pos[1] - 0.5, 0.4, p.pos[0] + 0.5, p.pos[1] + 0.5, Z0, { l: '#e7e9e6', m: '#bfc4c3', d: '#8d9493' }, toneI, 0.5),
  }));
}

/** Everything drawn on the paper under the board: one connected cast shadow. */
export function boardShadow() {
  const pts: V3[] = [];
  for (const x of [-L2, L2]) for (const y of [-W2, W2]) pts.push([x, y, 0], [x, y, Z1]);
  for (const x of [-21.6, 14]) for (const y of [-11.4, 11.4]) pts.push([x, y, B.pinTipZ]);
  return castShadow(pts, 0);
}

export function boardItems(st: BoardVisual) {
  const id = st.partId ?? 'esp32';
  const items: { box: [V3, V3]; svg: string; name?: string }[] = [
    ...stubs(),
    { box: [[-L2, -W2, Z0], [L2, W2, Z1]] as [V3, V3], svg: pcb(st) },
    { box: [[MOD.x0, MOD.y0, Z1], [MOD.x1, MOD.y1, MOD.z1]] as [V3, V3], svg: moduleWroom() },
    { box: [[CAN.x0, CAN.y0, MOD.z1], [CAN.x1, CAN.y1, CAN.z1]] as [V3, V3], svg: shieldCan() },
    { box: [[USB.x0, USB.y0, Z1], [USB.x1, USB.y1, USB.z1]] as [V3, V3], svg: usb() },
    { box: [[2.2, -7.5, Z1], [9.5, -3, Z1 + 1.8]] as [V3, V3], svg: box(3.4, -7.0, Z1, 9.2, -3.4, Z1 + 1.7, HEADER, toneI, 0.9) + box(2.2, -6.1, Z1, 3.4, -4.3, Z1 + 0.6, METAL, toneI, 0.6) + txZ(6.3, -5.2, Z1 + 1.72, 'AMS1117', 0.75, '#8b857c', 700, 'x') },
    { box: [[9, 2.4, Z1], [14, 7.4, Z1 + 0.9]] as [V3, V3], svg: qfn(9, 2.4, 14, 7.4) + txZ(11.5, 4.9, Z1 + 0.92, 'CP2102', 0.8, '#8b857c', 700, 'x') },
    { box: [[LED_PWR[0] - 0.8, LED_PWR[1] - 0.45, Z1], [LED_PWR[0] + 0.8, LED_PWR[1] + 0.45, Z1 + 0.6]] as [V3, V3], svg: smdLed(LED_PWR, RED_LED, st.powered ? 1 : 0) },
    { box: [[LED_IO2[0] - 0.8, LED_IO2[1] - 0.45, Z1], [LED_IO2[0] + 0.8, LED_IO2[1] + 0.45, Z1 + 0.6]] as [V3, V3], svg: smdLed(LED_IO2, BLUE_LED, st.led2) },
    { box: [[BTN.en[0] - 1.9, BTN.en[1] - 2.6, Z1], [BTN.en[0] + 1.9, BTN.en[1] + 2.6, Z1 + 2.6]] as [V3, V3], svg: button(BTN.en[0], BTN.en[1], st.enDown, 'EN', id) },
    { box: [[BTN.boot[0] - 1.9, BTN.boot[1] - 2.6, Z1], [BTN.boot[0] + 1.9, BTN.boot[1] + 2.6, Z1 + 2.6]] as [V3, V3], svg: button(BTN.boot[0], BTN.boot[1], st.bootDown, 'BOOT', id) },
  ];
  for (const side of ['left', 'right'] as const) {
    const ps = B.pins.filter((p) => p.side === side);
    items.push({ box: [[ps[0].pos[0] - 1.27, ps[0].pos[1] - 1.27, Z1], [ps[14].pos[0] + 1.27, ps[0].pos[1] + 1.27, STRIP_TOP]], svg: headerStrip(side) });
    for (const p of ps) {
      items.push({
        box: [[p.pos[0] - 1.2, p.pos[1] - 1.2, STRIP_TOP], [p.pos[0] + 1.2, p.pos[1] + 1.2, p.pos[2]]],
        svg: pin(p, id, st.hot?.[p.id]),
      });
    }
  }
  return items;
}

export function drawEsp32Doit(st: BoardVisual): string {
  let s = sortSvg(boardItems(st));
  s += glow(LED_PWR, RED_LED, st.powered ? 0.55 : 0, 2.2);
  s += glow(LED_IO2, BLUE_LED, st.led2, 3.2);
  return s;
}

export const BOARD_TERMINALS = B.pins.map((p) => ({ id: p.id, label: p.label, pos: p.pos }));
