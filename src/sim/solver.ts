/*
  DC operating-point solver (modified nodal analysis, simplified).

  Elements:
    R   resistor
    SW  switch (closed = 0.05 Ω, open = no connection)
    V   voltage source with a series resistance (stamped as its Norton equivalent, so no extra unknowns)
    D   diode / LED, piecewise linear: off = open; on = Vf + I·Rs. Solved by iterating the on/off guesses.
  Node 0 is ground. Every other node also gets a tiny leak (GMIN) to ground so islands that touch no source stay
  solvable; whether a node is really driven is answered separately by `drivenNodes`.

  This is deliberately a teaching-grade model: no capacitance, no transients, no reverse breakdown.
*/

export type Element =
  | { kind: 'R'; id: string; a: number; b: number; ohms: number }
  | { kind: 'SW'; id: string; a: number; b: number; closed: boolean }
  | { kind: 'V'; id: string; p: number; n: number; volts: number; ohms: number }
  | { kind: 'D'; id: string; a: number; b: number; vf: number; rs: number };

export interface Solution {
  /** Node voltages (index = node id). */
  v: Float64Array;
  /** Current through each element in amps, positive a→b (for V: out of p through the series resistor). */
  current: Map<string, number>;
  /** Diodes found conducting. */
  diodeOn: Set<string>;
  converged: boolean;
}

const GMIN = 1e-9;
const R_CLOSED = 0.05;

export function solve(nodeCount: number, elements: Element[]): Solution {
  const n = nodeCount - 1; // unknowns: nodes 1..nodeCount-1
  const diodes = elements.filter((e): e is Extract<Element, { kind: 'D' }> => e.kind === 'D');
  const on = new Set<string>();
  let v: Float64Array = new Float64Array(nodeCount);
  let converged = false;

  for (let iter = 0; iter < 40; iter++) {
    v = stampAndSolve(n, elements, on);
    let changed = false;
    for (const d of diodes) {
      const vd = v[d.a] - v[d.b];
      const isOn = on.has(d.id);
      if (isOn) {
        const i = (vd - d.vf) / d.rs;
        if (i < -1e-9) { on.delete(d.id); changed = true; }
      } else if (vd > d.vf + 1e-6) {
        on.add(d.id);
        changed = true;
      }
    }
    if (!changed) { converged = true; break; }
  }

  const current = new Map<string, number>();
  for (const e of elements) {
    switch (e.kind) {
      case 'R': current.set(e.id, (v[e.a] - v[e.b]) / e.ohms); break;
      case 'SW': current.set(e.id, e.closed ? (v[e.a] - v[e.b]) / R_CLOSED : 0); break;
      case 'V': current.set(e.id, (e.volts - (v[e.p] - v[e.n])) / e.ohms); break;
      case 'D': current.set(e.id, on.has(e.id) ? Math.max(0, (v[e.a] - v[e.b] - e.vf) / e.rs) : 0); break;
    }
  }
  return { v, current, diodeOn: on, converged };
}

function stampAndSolve(n: number, elements: Element[], on: Set<string>): Float64Array {
  const G = Array.from({ length: n }, () => new Float64Array(n));
  const I = new Float64Array(n);
  const g = (a: number, b: number, c: number) => {
    if (a > 0) G[a - 1][a - 1] += c;
    if (b > 0) G[b - 1][b - 1] += c;
    if (a > 0 && b > 0) { G[a - 1][b - 1] -= c; G[b - 1][a - 1] -= c; }
  };
  const inj = (node: number, amps: number) => { if (node > 0) I[node - 1] += amps; };
  for (let k = 0; k < n; k++) G[k][k] += GMIN;
  for (const e of elements) {
    switch (e.kind) {
      case 'R': g(e.a, e.b, 1 / Math.max(e.ohms, 1e-6)); break;
      case 'SW': if (e.closed) g(e.a, e.b, 1 / R_CLOSED); break;
      case 'V': {
        const c = 1 / Math.max(e.ohms, 1e-6);
        g(e.p, e.n, c);
        inj(e.p, e.volts * c);
        inj(e.n, -e.volts * c);
        break;
      }
      case 'D': {
        if (!on.has(e.id)) break;
        const c = 1 / e.rs;
        g(e.a, e.b, c);
        // I = c·(Va − Vb − Vf): the −c·Vf part is a fixed current from b to a
        inj(e.a, e.vf * c);
        inj(e.b, -e.vf * c);
        break;
      }
    }
  }
  const x = gauss(G, I);
  const v = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) v[k + 1] = x[k];
  return v;
}

function gauss(A: Float64Array[], b: Float64Array): Float64Array {
  const n = b.length;
  const M = A.map((row) => Float64Array.from(row));
  const x = Float64Array.from(b);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-30) continue;
    if (p !== c) { [M[p], M[c]] = [M[c], M[p]]; [x[p], x[c]] = [x[c], x[p]]; }
    for (let r = c + 1; r < n; r++) {
      const k = M[r][c] / M[c][c];
      if (k === 0) continue;
      for (let j = c; j < n; j++) M[r][j] -= k * M[c][j];
      x[r] -= k * x[c];
    }
  }
  for (let c = n - 1; c >= 0; c--) {
    let s = x[c];
    for (let j = c + 1; j < n; j++) s -= M[c][j] * x[j];
    x[c] = Math.abs(M[c][c]) < 1e-30 ? 0 : s / M[c][c];
  }
  return x;
}

/**
 * Nodes with a resistive path (resistors, closed switches, conducting or not-yet-conducting diodes excluded) to a
 * source or to ground. Anything else is floating: its voltage is undefined and a digital read is noise.
 */
export function drivenNodes(nodeCount: number, elements: Element[], solution?: Solution): Set<number> {
  const adj: number[][] = Array.from({ length: nodeCount }, () => []);
  const link = (a: number, b: number) => { adj[a].push(b); adj[b].push(a); };
  const roots = new Set<number>([0]);
  for (const e of elements) {
    if (e.kind === 'R') link(e.a, e.b);
    else if (e.kind === 'SW' && e.closed) link(e.a, e.b);
    else if (e.kind === 'V') { roots.add(e.p); roots.add(e.n); link(e.p, e.n); }
    // a diode joins two nets only while real current flows: with one side open, the solver's tiny leakage path can
    // leave it nominally "on" at nanoamps, which must not make the open side look driven
    else if (e.kind === 'D' && solution?.diodeOn.has(e.id) && Math.abs(solution.current.get(e.id) ?? 1) > 1e-6) link(e.a, e.b);
  }
  const seen = new Set<number>(roots);
  const stack = [...roots];
  while (stack.length) {
    const k = stack.pop()!;
    for (const m of adj[k]) if (!seen.has(m)) { seen.add(m); stack.push(m); }
  }
  return seen;
}
