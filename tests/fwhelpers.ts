import { Engine } from '../src/sim/engine';
import { compileSketch } from '../src/sim/firmware/compiler';
import { blankSketchProject as blankProject, type Project } from '../src/sim/project';
import type { PartInstance } from '../src/sim/types';

type T = [string, string];
/** A code-mode project: parts by id → type (with optional params), wires as [part.term, part.term]. */
export function sketchProject(source: string, parts: Record<string, string | { type: string; params?: Record<string, unknown> }>, wires: [string, string][]): Project {
  const p = blankProject('test');
  p.runMode = 'code';
  p.firmware = { source };
  let x = 40;
  p.parts = Object.entries(parts).map(([id, d]): PartInstance => {
    const type = typeof d === 'string' ? d : d.type;
    const params = typeof d === 'string' ? {} : d.params ?? {};
    return { id, type, label: id.toUpperCase(), x: (x += 25), y: 0, rot: 0, params } as PartInstance;
  });
  const ref = (s: string) => { const [part, term] = s.split('.') as T; return { part, term }; };
  p.wires = wires.map(([a, b], i) => ({ id: `w${i}`, a: ref(a), b: ref(b), color: 'red' }));
  return p;
}

/** Compile the project's sketch, upload it and boot (what Run does). */
export function runSketch(p: Project, seed = 7) {
  const r = compileSketch(p.firmware!.source);
  if (!r.ok) throw new Error('compile failed:\n' + r.diagnostics.map((d) => `${d.line}:${d.col} ${d.severity} ${d.message}`).join('\n'));
  const e = new Engine(p, { seed });
  e.upload(r.program!, p.firmware!.source);
  e.start();
  return e;
}

export const out = (e: Engine) => e.serial.filter((l) => l.kind === 'out').map((l) => l.text);
