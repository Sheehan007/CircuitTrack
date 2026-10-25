import { Engine } from '../src/sim/engine';
import type { Project } from '../src/sim/project';

export const has = (e: Engine, code: string) => e.snapshot().issues.some((i) => i.code === code);
export const codes = (e: Engine) => e.snapshot().issues.map((i) => i.code);
export const serialText = (e: Engine) => e.serial.map((l) => l.text).join('\n');

export function run(p: Project, ms = 0, seed = 7) {
  const e = new Engine(p, { seed });
  e.start();
  if (ms) e.advance(ms);
  return e;
}

/** Move the far end of the wire attached to `from` onto `to` (e.g. move the DHT's DATA wire to another GPIO). */
export function rewire(p: Project, from: { part: string; term: string }, to: { part: string; term: string }): Project {
  const copy: Project = JSON.parse(JSON.stringify(p));
  const w = copy.wires.find((x) => (x.a.part === from.part && x.a.term === from.term) || (x.b.part === from.part && x.b.term === from.term));
  if (!w) throw new Error(`no wire at ${from.part}.${from.term}`);
  if (w.a.part === from.part && w.a.term === from.term) w.b = { ...to }; else w.a = { ...to };
  return copy;
}
