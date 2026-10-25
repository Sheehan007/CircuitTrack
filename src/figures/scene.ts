/*
  Scene composer: turns a project + simulator snapshot into one SVG drawing for the stage.

  Every part is drawn in its own local frame by turning the camera the other way (drawing a part rotated by r with
  the camera at yaw is the same as drawing it unrotated with the camera at yaw − r), then moved into place with a
  screen-space translate (the projection is affine). Parts are depth-sorted by their world boxes; wires are drawn
  last, arcing above everything like real jumper wires. This module only reads simulator state; it never changes it.
*/
import { Dv, P, f, inkScale, pd, setCam, setFrame, setLight, resetClips, vis as isFacing, type V3 } from './engine/core.js';
import { BOARD_BOX, boardShadow, drawEsp32Doit } from './parts/esp32Doit';
import { DRAWERS } from './index';
import { depthSort } from './lib';
import type { PartDrawing } from './parts/types';
import { getDef } from '../sim/components/registry';
import { DOIT_DEVKIT_V1 } from '../sim/boards/doitDevkitV1';
import { rotLocal, terminalWorld } from '../sim/netlist';
import { BOARD_PART_ID, type Project } from '../sim/project';
import type { Snapshot } from '../sim/engine';
import { termKey, type TermRef } from '../sim/types';
import { esc } from './lib';

setLight(105);

export const PITCH = Math.atan(1 / Math.SQRT2) * 180 / Math.PI;

export interface SceneInput {
  project: Project;
  snap: Snapshot | null;
  /** Camera yaw in degrees (45 = the classic front-left view). */
  yaw: number;
  /** Scene units per screen pixel: strokes are scaled so lines keep their weight at every zoom. */
  unitsPerPx: number;
  selection: { kind: 'part' | 'wire'; id: string } | null;
  hoverTerm: string | null;
  draft: { from: TermRef; to: [number, number] } | null;
  /** Terminals that would be valid ends for the draft wire. */
  labels: 'none' | 'wired' | 'all';
  wobble: boolean;
}

export interface SceneOutput {
  shadows: string;
  parts: string;
  wires: string;
  labels: string;
  /** Screen position (scene units) of every terminal, for snapping and hit-testing. */
  terminals: Map<string, [number, number]>;
  bounds: [number, number, number, number];
}

const cache = new Map<string, PartDrawing>();
const CACHE_MAX = 400;

function cached(key: string, make: () => PartDrawing) {
  let d = cache.get(key);
  if (!d) {
    d = make();
    cache.set(key, d);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  }
  return d;
}

const worldBox = (b: [V3, V3], rot: number, x: number, y: number, z = 0): [V3, V3] => {
  const pts = [b[0], [b[1][0], b[0][1], 0], [b[0][0], b[1][1], 0], b[1]].map((p) => rotLocal([p[0], p[1], 0], rot));
  const xs = pts.map((p) => p[0] + x), ys = pts.map((p) => p[1] + y);
  return [[Math.min(...xs), Math.min(...ys), b[0][2] + z], [Math.max(...xs), Math.max(...ys), b[1][2] + z]];
};

const visualKey = (v: Record<string, unknown> | undefined) =>
  v ? JSON.stringify(v, (k, val) => (k === 'pixels' ? undefined : typeof val === 'number' ? Math.round(val * 50) / 50 : val)) : '';

export function composeScene(inp: SceneInput): SceneOutput {
  const { project, snap, yaw } = inp;
  const inkK = inp.unitsPerPx * 1.25;
  setFrame({ ox: 0, oy: 0, rc: [0, 0], rcz: 0, inkK });
  resetClips();
  const terminals = new Map<string, [number, number]>();
  const wiredColor = new Map<string, string>();
  for (const w of project.wires) { wiredColor.set(termKey(w.a), w.color); wiredColor.set(termKey(w.b), w.color); }
  const hotFor = (partId: string, terms: string[]) => {
    const h: Record<string, string> = {};
    for (const t of terms) {
      const k = `${partId}:${t}`;
      if (inp.hoverTerm === k) h[t] = '#f4b829';
      else if (inp.draft && termKey(inp.draft.from) === k) h[t] = '#f4b829';
      else if (inp.draft) h[t] = '#ffffff88';
    }
    return h;
  };

  type Item = { box: [V3, V3]; svg: string; shadow: string; overlay: string };
  const items: Item[] = [];

  // the board
  {
    const { x, y, rot } = project.boardPlacement;
    setCam(yaw - 90 * rot, PITCH);
    const b = snap?.board;
    const hot = hotFor(BOARD_PART_ID, DOIT_DEVKIT_V1.pins.map((p) => p.id));
    const key = `board|${rot}|${yaw}|${b ? `${b.led2.toFixed(2)}${b.enDown}${b.bootDown}` : ''}|${JSON.stringify(hot)}`;
    const d = cached(key, () => ({ body: drawEsp32Doit({ powered: true, led2: b?.led2 ?? 0, enDown: !!b?.enDown, bootDown: !!b?.bootDown, hot, silk: true }), overlay: '', shadow: boardShadow() }));
    setCam(yaw, PITCH);
    const [tx, ty] = Dv(x, y, 0);
    const sel = inp.selection?.kind === 'part' && inp.selection.id === BOARD_PART_ID;
    items.push({
      box: worldBox(BOARD_BOX, rot, x, y),
      svg: `<g class="part board${sel ? ' selected' : ''}" data-part-id="${BOARD_PART_ID}" transform="translate(${f(tx)} ${f(ty)})" aria-label="ESP32 DOIT DevKit V1 board"><g${inp.wobble ? ' filter="url(#hand)"' : ''}>${d.body}</g></g>`,
      shadow: `<g transform="translate(${f(tx)} ${f(ty)})">${d.shadow}</g>`,
      overlay: '',
    });
  }

  for (const part of project.parts) {
    const def = getDef(part.type);
    const draw = DRAWERS[part.type];
    if (!draw) continue;
    const visual = snap?.parts[part.id]?.visual ?? {};
    const params = { ...def.defaults, ...part.params };
    const hot = hotFor(part.id, def.terminals.map((t) => t.id));
    setCam(yaw - 90 * part.rot, PITCH);
    const key = `${part.type}|${part.id}|${part.rot}|${yaw}|${JSON.stringify(params)}|${visualKey(visual)}|${visual.frame ?? ''}|${JSON.stringify(hot)}`;
    const d = cached(key, () => draw({ partId: part.id, params, visual, hot }));
    setCam(yaw, PITCH);
    const z = part.z ?? 0;
    const [tx, ty] = Dv(part.x, part.y, z);
    const sel = inp.selection?.kind === 'part' && inp.selection.id === part.id;
    const t = `transform="translate(${f(tx)} ${f(ty)})"`;
    // a part standing on a breadboard casts its shadow on the board's top, so it is drawn with the part itself
    const raised = z > 0;
    items.push({
      box: worldBox(def.bounds, part.rot, part.x, part.y, z),
      svg: `<g class="part${sel ? ' selected' : ''}" data-part-id="${part.id}" ${t}><title>${esc(part.label)}</title>${raised ? `<g opacity=".55">${d.shadow}</g>` : ''}<g${inp.wobble ? ' filter="url(#hand)"' : ''}>${d.body}</g>${d.overlay}</g>`,
      shadow: raised ? '' : `<g ${t}>${d.shadow}</g>`,
      overlay: d.overlay,
    });
  }

  // terminal screen positions (world → screen with the global camera)
  setCam(yaw, PITCH);
  for (const p of DOIT_DEVKIT_V1.pins) {
    const w = terminalWorld(project, DOIT_DEVKIT_V1, { part: BOARD_PART_ID, term: p.id });
    if (w) terminals.set(`${BOARD_PART_ID}:${p.id}`, P(w[0], w[1], w[2]) as [number, number]);
  }
  for (const part of project.parts) for (const t of getDef(part.type).terminals) {
    const w = terminalWorld(project, DOIT_DEVKIT_V1, { part: part.id, term: t.id });
    if (w) terminals.set(`${part.id}:${t.id}`, P(w[0], w[1], w[2]) as [number, number]);
  }

  const sorted = depthSort(items);
  const shadows = items.map((i) => i.shadow).join('');
  const parts = sorted.map((i) => i.svg).join('');
  const wires = drawWires(inp);
  const labels = drawPinLabels(inp, terminals, wiredColor);

  // bounds of everything, for "fit to view"
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of items) for (const x of [it.box[0][0], it.box[1][0]]) for (const y of [it.box[0][1], it.box[1][1]]) for (const z of [it.box[0][2], it.box[1][2]]) {
    const [X, Y] = P(x, y, z);
    x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y);
  }
  return { shadows: inkScale(shadows), parts: inkScale(parts), wires: inkScale(wires), labels, terminals, bounds: [x0, y0, x1, y1] };
}

/* ---------------- wires ---------------- */

function wirePath(a: V3, b: V3): V3[] {
  const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const lift = 6 + dist * 0.18;
  const top = Math.max(a[2], b[2]) + lift;
  const c1: V3 = [a[0], a[1], top], c2: V3 = [b[0], b[1], top];
  const pts: V3[] = [];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28, u = 1 - t;
    pts.push([0, 1, 2].map((k) => u * u * u * a[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * b[k]) as V3);
  }
  return pts;
}

function connector(at: V3, onPin: boolean) {
  if (onPin) {
    // Dupont housing over a header pin
    const [x, y, z] = at;
    const top = z + 1.6, bot = z - 4.6;
    const faces: [V3, V3[]][] = [
      [[1, 0, 0], [[x + 1.25, y - 1.25, bot], [x + 1.25, y + 1.25, bot], [x + 1.25, y + 1.25, top], [x + 1.25, y - 1.25, top]]],
      [[0, 1, 0], [[x - 1.25, y + 1.25, bot], [x + 1.25, y + 1.25, bot], [x + 1.25, y + 1.25, top], [x - 1.25, y + 1.25, top]]],
      [[-1, 0, 0], [[x - 1.25, y - 1.25, bot], [x - 1.25, y + 1.25, bot], [x - 1.25, y + 1.25, top], [x - 1.25, y - 1.25, top]]],
      [[0, -1, 0], [[x - 1.25, y - 1.25, bot], [x + 1.25, y - 1.25, bot], [x + 1.25, y - 1.25, top], [x - 1.25, y - 1.25, top]]],
      [[0, 0, 1], [[x - 1.25, y - 1.25, top], [x + 1.25, y - 1.25, top], [x + 1.25, y + 1.25, top], [x - 1.25, y + 1.25, top]]],
    ];
    const shades = ['#3d3935', '#2a2724', '#2a2724', '#3d3935', '#4b4641'];
    let s = '';
    faces.forEach(([n, q], i) => {
      if (isFacing(n)) s += `<path d="${pd(q)}" fill="${shades[i]}" stroke="#1a1714" stroke-width=".8" stroke-linejoin="round"/>`;
    });
    return s;
  }
  // crimp bead on a component lead
  const [X, Y] = P(at[0], at[1], at[2]);
  return `<circle cx="${f(X)}" cy="${f(Y)}" r="${f(1.0 * Math.hypot(...(Dv(1, 0, 0) as [number, number])))}" fill="#c8cfd1" stroke="#231e16" stroke-width=".8"/>`;
}


function drawWires(inp: SceneInput) {
  const { project } = inp;
  let s = '';
  const world = (t: TermRef) => terminalWorld(project, DOIT_DEVKIT_V1, t);
  const onPin = (w: V3) => w[2] > 5;
  for (const w of project.wires) {
    const a = world(w.a), b = world(w.b);
    if (!a || !b) continue;
    const pts = wirePath(a, b);
    const d = pd(pts, false);
    const sel = inp.selection?.kind === 'wire' && inp.selection.id === w.id;
    s += `<g class="wire${sel ? ' selected' : ''}" data-wire-id="${w.id}">`
      + (sel ? `<path d="${d}" fill="none" stroke="#f4b829" stroke-width="6.5" stroke-linecap="round" opacity=".85"/>` : '')
      + `<path d="${d}" fill="none" stroke="#231e16" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>`
      + `<path d="${d}" fill="none" stroke="${w.color}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>`
      + `<path d="${d}" fill="none" stroke="#ffffff" stroke-width=".6" stroke-linecap="round" opacity=".35" transform="translate(-.4 -.5)"/>`
      + connector(a, onPin(a)) + connector(b, onPin(b))
      + `<path d="${d}" fill="none" stroke="#000" stroke-opacity="0" stroke-width="9" class="wire-hit"/>`
      + `</g>`;
  }
  if (inp.draft) {
    const a = world(inp.draft.from);
    if (a) {
      const [X, Y] = P(a[0], a[1], a[2]);
      const [tx, ty] = inp.draft.to;
      s += `<path d="M${f(X)} ${f(Y)} Q${f((X + tx) / 2)} ${f(Math.min(Y, ty) - 30 * inp.unitsPerPx)} ${f(tx)} ${f(ty)}" fill="none" stroke="#231e16" stroke-width="2.4" stroke-dasharray="5 4" stroke-linecap="round" pointer-events="none"/>`;
    }
  }
  return s;
}

/* ---------------- pin labels (screen-space pills, outside the hand-drawn filter) ---------------- */

function drawPinLabels(inp: SceneInput, terminals: Map<string, [number, number]>, wired: Map<string, string>) {
  if (inp.labels === 'none' && !inp.hoverTerm) return '';
  const { project } = inp;
  const k = inp.unitsPerPx;
  const rot = project.boardPlacement.rot;
  let s = '';
  for (const p of DOIT_DEVKIT_V1.pins) {
    const key = `${BOARD_PART_ID}:${p.id}`;
    const isHover = inp.hoverTerm === key;
    const color = wired.get(key);
    if (!(inp.labels === 'all' || isHover || (inp.labels === 'wired' && color))) continue;
    const at = terminals.get(key);
    if (!at) continue;
    const outward = rotLocal([0, p.side === 'left' ? -1 : 1, 0], rot);
    const dv = Dv(outward[0], outward[1], 0);
    const len = Math.hypot(dv[0], dv[1]) || 1;
    const stagger = inp.labels === 'all' && p.index % 2 ? 26 : 0;
    const dist = (20 + stagger) * k;
    const cx = at[0] + (dv[0] / len) * dist, cy = at[1] + (dv[1] / len) * dist - 6 * k;
    const text = p.gpio != null && !p.label.startsWith('D') ? `${p.label} · ${p.gpio}` : p.label;
    const fs = 10 * k, w = (text.length * 0.62 + 1.4) * fs, h = fs * 1.7;
    s += `<g class="pin-label${isHover ? ' hover' : ''}" pointer-events="none">`
      + `<path d="M${f(at[0])} ${f(at[1])}L${f(cx)} ${f(cy)}" stroke="#231e16" stroke-width="${f(k)}" fill="none"/>`
      + `<rect x="${f(cx - w / 2)}" y="${f(cy - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(h / 2)}" fill="${isHover ? '#f4b829' : '#fff4d6'}" stroke="${color ?? '#231e16'}" stroke-width="${f((color ? 2 : 1.2) * k)}"/>`
      + `<text x="${f(cx)}" y="${f(cy + fs * 0.36)}" font-size="${f(fs)}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-weight="800" fill="#231e16">${text}</text></g>`;
  }
  // hovered component terminal
  if (inp.hoverTerm && !inp.hoverTerm.startsWith(`${BOARD_PART_ID}:`)) {
    const [partId, term] = inp.hoverTerm.split(':');
    const part = project.parts.find((x) => x.id === partId);
    const t = part && getDef(part.type).terminals.find((d) => d.id === term);
    const at = terminals.get(inp.hoverTerm);
    if (part && t && at) {
      const text = `${part.label} · ${t.label}`;
      const fs = 10 * k, w = (text.length * 0.62 + 1.4) * fs, h = fs * 1.7, cx = at[0], cy = at[1] - 22 * k;
      s += `<g class="pin-label hover" pointer-events="none"><path d="M${f(at[0])} ${f(at[1])}L${f(cx)} ${f(cy)}" stroke="#231e16" stroke-width="${f(k)}"/>`
        + `<rect x="${f(cx - w / 2)}" y="${f(cy - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(h / 2)}" fill="#f4b829" stroke="#231e16" stroke-width="${f(1.2 * k)}"/>`
        + `<text x="${f(cx)}" y="${f(cy + fs * 0.36)}" font-size="${f(fs)}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-weight="800" fill="#231e16">${text}</text></g>`;
    }
  }
  return s;
}

/** Point on the horizontal plane at height z under a screen point, for dropping and dragging parts. */
export function screenToGround(X: number, Y: number, yaw: number, z = 0): [number, number] {
  setCam(yaw, PITCH);
  const [zx, zy] = Dv(0, 0, z);
  X -= zx; Y -= zy;
  const [ax, ay] = Dv(1, 0, 0), [bx, by] = Dv(0, 1, 0);
  const det = ax * by - bx * ay;
  return [(X * by - bx * Y) / det, (ax * Y - X * ay) / det];
}

/** Small standalone drawing of one part for the catalogue (no wobble filter, its own viewBox). */
export function partThumbnail(type: string): string {
  const def = getDef(type);
  const draw = DRAWERS[type];
  if (!draw) return '';
  setFrame({ ox: 0, oy: 0, rc: [0, 0], rcz: 0, inkK: 0.12 });
  setCam(45, PITCH);
  const d = draw({ partId: `thumb-${type}`, params: { ...def.defaults }, visual: type === 'led' ? { brightness: 0.6 } : {}, hot: {} });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const x of [def.bounds[0][0], def.bounds[1][0]]) for (const y of [def.bounds[0][1], def.bounds[1][1]]) for (const z of [0, def.bounds[1][2]]) {
    const [X, Y] = P(x, y, z);
    x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y);
  }
  const pad = 2;
  const body = inkScale(d.shadow + d.body).replace(/data-act="[^"]*"/g, '');
  return `<svg viewBox="${f(x0 - pad)} ${f(y0 - pad)} ${f(x1 - x0 + 2 * pad)} ${f(y1 - y0 + 2 * pad)}" aria-hidden="true">${body}</svg>`;
}
