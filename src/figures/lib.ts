// Small drawing helpers on top of the vendored Colorfigures engine, shared by every part figure.
import {
  Dv, P, INK, f, fill, ink, matOf, mix, on, pd, PZ, rrUV, loft, toneI, hullInk, txM, sepOrder, camState, hull, castShadow, type Mat, type V3,
} from './engine/core.js';

export const PCB_BLACK: Mat = { l: '#434a58', m: '#2c323d', d: '#191d24' };
export const PCB_BLUE: Mat = { l: '#3f6fb5', m: '#2f5793', d: '#1a3157' };
export const PCB_GREEN: Mat = { l: '#4f8f5a', m: '#3b7346', d: '#1f3f27' };
export const HEADER: Mat = { l: '#3a3632', m: '#26231f', d: '#141210' };
export const GOLD: Mat = { l: '#f5d27a', m: '#d8ac4a', d: '#8f6d22' };
export const TIN: Mat = { l: '#f2f3f1', m: '#cdd2d3', d: '#959ea2' };
export const SHIELD: Mat = { l: '#e9ecec', m: '#c8cfd1', d: '#98a3a7' };
export const SILK = '#f4efe2';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Text lying flat on a horizontal plane (silkscreen, display labels). It picks whichever of the four in-plane
 * directions reads most naturally on screen (never mirrored), so it stays legible from every quarter view.
 * `along`: restrict to directions parallel to 'x' or 'y' (like real silkscreen that only runs one way).
 */
export function txZ(x: number, y: number, z: number, str: string, size: number, col = INK, weight = 700, along?: 'x' | 'y') {
  const dirs: V3[] = along === 'x' ? [[1, 0, 0], [-1, 0, 0]] : along === 'y' ? [[0, 1, 0], [0, -1, 0]] : [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
  let best: { U: [number, number]; V: [number, number]; score: number } | null = null;
  for (const d of dirs) {
    const U = Dv(d[0], d[1], d[2]) as [number, number];
    for (const s of [1, -1]) {
      const n: V3 = [-d[1] * s, d[0] * s, 0];
      const V = Dv(n[0], n[1], n[2]) as [number, number];
      if (U[0] * V[1] - U[1] * V[0] <= 0) continue;
      const len = Math.hypot(U[0], U[1]) || 1;
      const score = U[0] / len - Math.abs(U[1] / len) * 0.2;
      if (!best || score > best.score) best = { U, V, score };
    }
  }
  if (!best) return '';
  const o = P(x, y, z);
  return `<text transform="${txM(o, best.U, best.V)}" font-size="${size}" fill="${col}" text-anchor="middle" dominant-baseline="central" font-family="ui-monospace,Menlo,monospace" font-weight="${weight}" letter-spacing=".02em">${esc(str)}</text>`;
}

/** A flat rounded slab (PCB, module board) from z0 to z1 with its top face filled and inked. */
export function slab(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, r: number, m: Mat, w = 1.4) {
  const A = on(PZ(z0), rrUV(x0, y0, x1, y1, r, 4));
  const B = on(PZ(z1), rrUV(x0, y0, x1, y1, r, 4));
  return loft(A, B, (n) => toneI(n, m)) + fill(pd(B), m.l) + ink(pd(B), 0.8) + hullInk([...A, ...B], w);
}

/** Flat ellipse on a horizontal plane (holes, pads, LED lenses). */
export const disc = (cx: number, cy: number, z: number, r: number, col: string, w = 0, n = 16) => {
  const pts: V3[] = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a), z];
  });
  return fill(pd(pts), col) + (w ? ink(pd(pts), w) : '');
};

/** Soft light around a lit part, in screen space (no gradients, so no ids to collide). */
export function glow(at: V3, color: string, k: number, radius = 6) {
  if (k <= 0.02) return '';
  const [X, Y] = P(at[0], at[1], at[2]);
  const r = Math.hypot(...(Dv(radius, 0, 0) as [number, number]));
  let s = '';
  for (const [rr, a] of [[2.2, 0.1], [1.5, 0.18], [0.9, 0.3]] as const) {
    s += `<circle cx="${f(X)}" cy="${f(Y)}" r="${f(r * rr * (0.6 + 0.4 * k))}" fill="${color}" opacity="${(a * k).toFixed(3)}" style="mix-blend-mode:screen"/>`;
  }
  return `<g class="glow" pointer-events="none">${s}</g>`;
}

export const lit = (base: string, k: number) => mix(base, '#ffffff', Math.max(0, Math.min(1, k)) * 0.65);

export interface Sortable { box: [V3, V3]; svg: string }

/**
 * Painter's order for boxed parts. Like the engine's byDepth, but it only compares parts whose outlines overlap on
 * screen and then does a topological sort. Comparing every pair (as Array.sort does) lets pairs that never touch on
 * screen impose contradictory constraints, which scrambled flat assemblies like the board.
 */
export function depthSort<T extends Sortable>(items: T[]): T[] {
  const n = items.length;
  // exact screen outline of each box: the convex hull of its 8 projected corners
  const hulls = items.map(({ box: [a, b] }) => {
    const pts: [number, number][] = [];
    for (const x of [a[0], b[0]]) for (const y of [a[1], b[1]]) for (const z of [a[2], b[2]]) pts.push(P(x, y, z) as [number, number]);
    return hull(pts) as [number, number][];
  });
  const rect = hulls.map((h) => [Math.min(...h.map((p) => p[0])), Math.min(...h.map((p) => p[1])), Math.max(...h.map((p) => p[0])), Math.max(...h.map((p) => p[1]))]);
  const V = camState().V;
  const depth = items.map(({ box: [a, b] }) => ((a[0] + b[0]) / 2) * V[0] + ((a[1] + b[1]) / 2) * V[1] + ((a[2] + b[2]) / 2) * V[2]);
  const after: number[][] = Array.from({ length: n }, () => []);
  const indeg = new Array(n).fill(0);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const r = rect[i], s = rect[j];
    if (r[2] <= s[0] || s[2] <= r[0] || r[3] <= s[1] || s[3] <= r[1]) continue;
    if (!hullsOverlap(hulls[i], hulls[j])) continue;
    let o = sepOrder(items[i], items[j]);
    if (!o) o = depth[i] - depth[j] < 0 ? -1 : 1;
    const [first, second] = o < 0 ? [i, j] : [j, i];
    after[first].push(second);
    indeg[second]++;
  }
  const out: T[] = [];
  const done = new Array(n).fill(false);
  for (let k = 0; k < n; k++) {
    let pick = -1;
    for (let i = 0; i < n; i++) if (!done[i] && indeg[i] === 0 && (pick < 0 || depth[i] < depth[pick])) pick = i;
    // a genuine cycle (interlocking parts): break it at the part with the fewest unmet constraints, then the farthest
    if (pick < 0) for (let i = 0; i < n; i++) if (!done[i] && (pick < 0 || indeg[i] < indeg[pick] || (indeg[i] === indeg[pick] && depth[i] < depth[pick]))) pick = i;
    done[pick] = true;
    out.push(items[pick]);
    for (const m of after[pick]) indeg[m]--;
  }
  return out;
}

/** Separating-axis test for two convex polygons (a shared edge or touching corner does not count as overlap). */
function hullsOverlap(a: [number, number][], b: [number, number][]) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const nx = q[1] - p[1], ny = p[0] - q[0];
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const v of a) { const d = v[0] * nx + v[1] * ny; amin = Math.min(amin, d); amax = Math.max(amax, d); }
      for (const v of b) { const d = v[0] * nx + v[1] * ny; bmin = Math.min(bmin, d); bmax = Math.max(bmax, d); }
      const eps = 1e-6 * (Math.abs(nx) + Math.abs(ny));
      if (amax <= bmin + eps || bmax <= amin + eps) return false;
    }
  }
  return true;
}

export const sortSvg = (items: (Sortable | null | false | undefined)[]) => depthSort(items.filter(Boolean) as Sortable[]).map((i) => i.svg).join('');
export { matOf, esc };

/** Cast shadow of an upright box (all eight corners, so the outline is the true silhouette). */
export const boxShadow = (x0: number, y0: number, x1: number, y1: number, h: number) => {
  const pts: V3[] = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [0, h]) pts.push([x, y, z]);
  return castShadow(pts, 0);
};

/** Cast shadow of an upright cylinder (LEDs, buzzers, knobs). */
export const ringShadow = (cx: number, cy: number, r: number, h: number) => {
  const pts: V3[] = [];
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; for (const z of [0, h]) pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), z]); }
  return castShadow(pts, 0);
};
