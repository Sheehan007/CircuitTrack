import { getDef } from './components/registry';
import type { BoardProfile } from './boards/types';
import { BOARD_PART_ID, type Project } from './project';
import { termKey, type TermRef, type V3 } from './types';

/** Rotate a part-local point by quarter turns (counter-clockwise seen from above: +x toward +y). */
export function rotLocal([x, y, z]: V3, rot: number): V3 {
  switch (((rot % 4) + 4) % 4) {
    case 1: return [-y, x, z];
    case 2: return [-x, -y, z];
    case 3: return [y, -x, z];
    default: return [x, y, z];
  }
}

export function terminalWorld(project: Project, board: BoardProfile, t: TermRef): V3 | null {
  if (t.part === BOARD_PART_ID) {
    const pin = board.pins.find((p) => p.id === t.term);
    if (!pin) return null;
    const { x, y, rot } = project.boardPlacement;
    const r = rotLocal(pin.pos, rot);
    return [r[0] + x, r[1] + y, r[2]];
  }
  const part = project.parts.find((p) => p.id === t.part);
  if (!part) return null;
  const term = getDef(part.type).terminals.find((d) => d.id === t.term);
  if (!term) return null;
  const r = rotLocal(term.pos, part.rot);
  return [r[0] + part.x, r[1] + part.y, r[2] + (part.z ?? 0)];
}

export interface Insertion { part: string; term: string; board: string; hole: string }

/**
 * Legs plugged into breadboard holes: a leg counts as inserted when it sits on a hole (within 0.9 mm) at the
 * breadboard's surface. These join the leg to the hole's strip exactly like a wire would.
 */
export function insertions(project: Project, board: BoardProfile): Insertion[] {
  const boards = project.parts.filter((p) => p.type === 'breadboard');
  if (!boards.length) return [];
  const out: Insertion[] = [];
  const holes = boards.map((bb) => {
    const def = getDef(bb.type);
    return { bb, list: def.terminals.map((t) => { const r = rotLocal(t.pos, bb.rot); return { id: t.id, x: r[0] + bb.x, y: r[1] + bb.y, z: r[2] + (bb.z ?? 0) }; }) };
  });
  for (const part of project.parts) {
    if (part.type === 'breadboard' || !getDef(part.type).insertable || !(part.z ?? 0)) continue;
    for (const t of getDef(part.type).terminals) {
      const w = terminalWorld(project, board, { part: part.id, term: t.id });
      if (!w) continue;
      for (const { bb, list } of holes) {
        const h = list.find((q) => Math.abs(q.x - w[0]) < 0.9 && Math.abs(q.y - w[1]) < 0.9 && Math.abs(q.z - w[2]) < 1.5);
        if (h) { out.push({ part: part.id, term: t.id, board: bb.id, hole: h.id }); break; }
      }
    }
  }
  return out;
}

export interface Net {
  index: number;
  terms: TermRef[];
  /** Readable name: a board pin label if the net reaches one, else the first terminal. */
  name: string;
}

export interface Netlist {
  /** Legs plugged into breadboard holes. */
  insertions: Insertion[];
  nets: Net[];
  netOf: Map<string, number>;
  /** All terminals that exist, in a stable order. */
  terms: TermRef[];
}

class DSU {
  p: number[];
  constructor(n: number) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(i: number): number { while (this.p[i] !== i) { this.p[i] = this.p[this.p[i]]; i = this.p[i]; } return i; }
  union(a: number, b: number) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p[rb] = ra; }
}

/**
 * Group every terminal into electrical nets. Net 0 is always the board's ground (both GND pins are joined on the
 * PCB). Wires and a part's internal shorts (e.g. a tactile switch's leg pairs) join terminals.
 */
export function buildNetlist(project: Project, board: BoardProfile): Netlist {
  const terms: TermRef[] = board.pins.map((p) => ({ part: BOARD_PART_ID, term: p.id }));
  for (const part of project.parts) for (const t of getDef(part.type).terminals) terms.push({ part: part.id, term: t.id });
  const index = new Map(terms.map((t, i) => [termKey(t), i]));
  const dsu = new DSU(terms.length);
  const join = (a: TermRef, b: TermRef) => {
    const ia = index.get(termKey(a)), ib = index.get(termKey(b));
    if (ia != null && ib != null) dsu.union(ia, ib);
  };
  join({ part: BOARD_PART_ID, term: 'GND_L' }, { part: BOARD_PART_ID, term: 'GND_R' });
  for (const part of project.parts) {
    for (const [a, b] of getDef(part.type).internalShorts ?? []) join({ part: part.id, term: a }, { part: part.id, term: b });
  }
  for (const w of project.wires) join(w.a, w.b);
  const ins = insertions(project, board);
  for (const i of ins) join({ part: i.part, term: i.term }, { part: i.board, term: i.hole });

  const gndRoot = dsu.find(index.get(`${BOARD_PART_ID}:GND_L`)!);
  const rootToNet = new Map<number, number>([[gndRoot, 0]]);
  const nets: Net[] = [{ index: 0, terms: [], name: 'GND' }];
  const netOf = new Map<string, number>();
  terms.forEach((t, i) => {
    const r = dsu.find(i);
    let n = rootToNet.get(r);
    if (n == null) { n = nets.length; rootToNet.set(r, n); nets.push({ index: n, terms: [], name: '' }); }
    nets[n].terms.push(t);
    netOf.set(termKey(t), n);
  });
  for (const net of nets) {
    if (net.index === 0) continue;
    const pin = net.terms.find((t) => t.part === BOARD_PART_ID);
    const def = pin && board.pins.find((p) => p.id === pin.term);
    net.name = def ? (def.gpio != null ? `GPIO${def.gpio}` : def.label) : `${net.terms[0].part}.${net.terms[0].term}`;
  }
  return { nets, netOf, terms, insertions: ins };
}

/** Terminals that share a net with anything else (i.e. are actually wired). */
export function isWired(nl: Netlist, t: TermRef) {
  const n = nl.netOf.get(termKey(t));
  return n != null && nl.nets[n].terms.length > 1;
}
