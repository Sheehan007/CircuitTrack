// Everything that changes the project on the bench goes through here: one place for undo, autosave and hot-swapping
// the circuit into the running simulation.
import { getDef } from '../sim/components/registry';
import { DOIT_DEVKIT_V1 } from '../sim/boards/doitDevkitV1';
import { BB, stripOf } from '../sim/components/breadboard';
import { insertions, rotLocal } from '../sim/netlist';
import type { PartInstance } from '../sim/types';
import { BOARD_PART_ID, STARTER_SKETCH, blankSketchProject, cloneProject, nextLabel, nextPartId, uid, type Project } from '../sim/project';
import type { Program } from '../sim/program/types';
import { termKey, type TermRef } from '../sim/types';
import { LESSONS, type Lesson } from '../content/lessons';
import { TEMPLATES } from '../content/templates';
import { loadProject, reupload, stop } from './host';
import { generateSketch } from '../sim/program/codegen';
import { store, toast, type Mode } from './store';
import { deleteProject, getCurrentId, listProjects, saveProgress, saveProject, setCurrentId } from './storage';

const GRID = 2.54;
const snap = (v: number) => Math.round(v / GRID) * GRID;

/* ---------------- undo / redo ---------------- */

let past: Project[] = [];
let future: Project[] = [];
let lastBuildProject: Project | null = null;

function commit(next: Project, opts: { record?: boolean; label?: string } = {}) {
  const s = store.get();
  if (opts.record !== false) {
    past.push(s.project);
    if (past.length > 80) past.shift();
    future = [];
  }
  next = { ...next, updatedAt: Date.now() };
  store.set({ project: next, canUndo: past.length > 0, canRedo: future.length > 0 });
  loadProject(next, { keepRunning: true });
  if (s.mode === 'build') autosave(next);
}

let saveTimer = 0;
function autosave(p: Project) {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    if (store.get().project.id !== p.id || store.get().mode !== 'build') return;
    const ok = saveProject(store.get().project);
    setCurrentId(p.id);
    if (!ok) toast('Could not save: browser storage is unavailable or full.');
    else if (!store.get().saved) store.set({ saved: true });
  }, 400);
}

export function undo() {
  const p = past.pop();
  if (!p) return;
  future.push(store.get().project);
  store.set({ project: p, canUndo: past.length > 0, canRedo: true });
  loadProject(p, { keepRunning: true });
  if (store.get().mode === 'build') autosave(p);
}

export function redo() {
  const p = future.pop();
  if (!p) return;
  past.push(store.get().project);
  store.set({ project: p, canUndo: true, canRedo: future.length > 0 });
  loadProject(p, { keepRunning: true });
  if (store.get().mode === 'build') autosave(p);
}

const edit = (fn: (p: Project) => void, opts?: { record?: boolean }) => {
  const p = cloneProject(store.get().project);
  fn(p);
  commit(p, opts);
};

/* ---------------- parts ---------------- */

/** World-space footprint (x0, y0, x1, y1) of a part or of the board. */
function footprint(type: string, x: number, y: number, rot: number): [number, number, number, number] {
  const b = type === BOARD_PART_ID ? [[-26, -15], [26.5, 15]] : getDef(type).bounds.map((v) => [v[0], v[1]]);
  const corners = [[b[0][0], b[0][1]], [b[1][0], b[0][1]], [b[0][0], b[1][1]], [b[1][0], b[1][1]]].map(([cx, cy]) => {
    const r = ((rot % 4) + 4) % 4;
    return r === 1 ? [-cy, cx] : r === 2 ? [-cx, -cy] : r === 3 ? [cy, -cx] : [cx, cy];
  });
  const xs = corners.map((c) => c[0] + x), ys = corners.map((c) => c[1] + y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** The free spot nearest to "in front of the board" for a new part (so parts never pile up on each other). */
function freeSpot(p: Project, type: string): [number, number] {
  const taken = [footprint(BOARD_PART_ID, p.boardPlacement.x, p.boardPlacement.y, p.boardPlacement.rot), ...p.parts.map((q) => footprint(q.type, q.x, q.y, q.rot))];
  const gap = 4;
  const free = (x: number, y: number) => {
    const f = footprint(type, x, y, 0);
    return taken.every((t) => f[2] + gap <= t[0] || t[2] + gap <= f[0] || f[3] + gap <= t[1] || t[3] + gap <= f[1]);
  };
  const cands: [number, number][] = [];
  for (let gx = -40; gx <= 40; gx++) for (let gy = 0; gy <= 40; gy++) cands.push([gx * 5.08, p.boardPlacement.y - 30 - gy * 5.08]);
  cands.sort((a, b) => Math.hypot(a[0], a[1] + 45) - Math.hypot(b[0], b[1] + 45));
  return cands.find(([x, y]) => free(x, y)) ?? [0, -60];
}

export function addPart(type: string, x?: number, y?: number) {
  const s = store.get();
  const p = cloneProject(s.project);
  const id = nextPartId(p, type);
  const [fx, fy] = x == null || y == null ? freeSpot(p, type) : [x, y];
  const np: PartInstance = { id, type, label: nextLabel(p, type), x: snap(fx), y: snap(fy), rot: 0, params: { ...getDef(type).defaults } };
  p.parts.push(np);
  settle(p, np);
  commit(p);
  store.set({ selection: { kind: 'part', id }, rightTab: 'inspector' });
  return id;
}

/**
 * A leaded part over a breadboard sits on it, shifted so its legs land in holes; anywhere else it sits on the bench.
 * When `orient` is set (a fresh drop), it is also turned so its legs land in different strips, since legs sharing a
 * strip are shorted together; an explicit rotation by the user is kept as it is.
 */
function settle(p: Project, part: PartInstance, orient = true) {
  const def = getDef(part.type);
  part.z = 0;
  if (!def.insertable) return false;
  for (const bb of p.parts.filter((q) => q.type === 'breadboard')) {
    const f = footprint('breadboard', bb.x, bb.y, bb.rot);
    if (part.x < f[0] || part.x > f[2] || part.y < f[1] || part.y > f[3]) continue;
    const holes = getDef('breadboard').terminals.map((t) => { const h = rotLocal(t.pos, bb.rot); return { id: t.id, x: h[0] + bb.x, y: h[1] + bb.y }; });
    const internal = new Set((def.internalShorts ?? []).map(([a, b]) => [a, b].sort().join('|')));
    const tryRot = (rot: number) => {
      // align the first leg with the nearest hole, then see where the other legs land
      const leg = rotLocal(def.terminals[0].pos, rot);
      const lx = part.x + leg[0], ly = part.y + leg[1];
      let best = holes[0], bd = Infinity;
      for (const h of holes) { const d = Math.hypot(h.x - lx, h.y - ly); if (d < bd) { bd = d; best = h; } }
      const x = part.x + best.x - lx, y = part.y + best.y - ly;
      const landed = def.terminals.map((t) => { const r = rotLocal(t.pos, rot); return holes.find((h) => Math.abs(h.x - (r[0] + x)) < 0.9 && Math.abs(h.y - (r[1] + y)) < 0.9); });
      let ok = landed.every(Boolean);
      for (let i = 0; ok && i < landed.length; i++) for (let j = i + 1; j < landed.length; j++) {
        if (!internal.has([def.terminals[i].id, def.terminals[j].id].sort().join('|')) && stripOf(landed[i]!.id) === stripOf(landed[j]!.id)) ok = false;
      }
      return { x, y, ok };
    };
    const rots = orient ? [0, 1, 2, 3].map((k) => (part.rot + k) % 4) : [part.rot];
    const pick = rots.map((r) => ({ r, ...tryRot(r) })).find((c) => c.ok) ?? { r: part.rot, ...tryRot(part.rot) };
    part.rot = pick.r; part.x = pick.x; part.y = pick.y; part.z = (bb.z ?? 0) + BB.top;
    return true;
  }
  return false;
}

export function movePart(id: string, x: number, y: number, record = true) {
  edit((p) => {
    if (id === BOARD_PART_ID) { p.boardPlacement.x = snap(x); p.boardPlacement.y = snap(y); return; }
    const part = p.parts.find((q) => q.id === id);
    if (!part) return;
    if (part.type === 'breadboard') {
      // parts plugged into the breadboard travel with it
      const riders = new Set(insertions(p, DOIT_DEVKIT_V1).filter((i) => i.board === id).map((i) => i.part));
      const dx = snap(x) - part.x, dy = snap(y) - part.y;
      part.x += dx; part.y += dy;
      for (const r of p.parts) if (riders.has(r.id)) { r.x += dx; r.y += dy; }
      return;
    }
    const wasOn = !!part.z;
    part.x = snap(x); part.y = snap(y);
    // re-orient only when it newly arrives on a breadboard
    settle(p, part, !wasOn);
  }, { record });
}

/** Push an undo point before a drag starts, then move without recording on every pointer move. */
export const beginDrag = () => { past.push(store.get().project); future = []; store.set({ canUndo: true, canRedo: false }); };

export function rotatePart(id: string) {
  edit((p) => {
    if (id === BOARD_PART_ID) { p.boardPlacement.rot = (p.boardPlacement.rot + 1) % 4; return; }
    const part = p.parts.find((q) => q.id === id);
    if (part) { part.rot = (part.rot + 1) % 4; if (part.z) settle(p, part, false); }
  });
}

export function duplicatePart(id: string) {
  const src = store.get().project.parts.find((q) => q.id === id);
  if (!src) return;
  const p = cloneProject(store.get().project);
  const nid = nextPartId(p, src.type);
  const copy: PartInstance = { ...JSON.parse(JSON.stringify(src)), id: nid, label: nextLabel(p, src.type), x: src.x + 7.62, y: src.y + 7.62 };
  p.parts.push(copy);
  settle(p, copy);
  commit(p);
  store.set({ selection: { kind: 'part', id: nid } });
}

export function deletePart(id: string) {
  if (id === BOARD_PART_ID) { toast('The ESP32 board stays on the bench: every project is built around it.'); return; }
  const label = store.get().project.parts.find((q) => q.id === id)?.label;
  edit((p) => {
    p.parts = p.parts.filter((q) => q.id !== id);
    p.wires = p.wires.filter((w) => w.a.part !== id && w.b.part !== id);
  });
  store.set({ selection: null });
  if (label) toast(`Deleted ${label} and its wires. Undo with Ctrl+Z.`);
}

export function renamePart(id: string, label: string) {
  edit((p) => { const part = p.parts.find((q) => q.id === id); if (part && label.trim()) part.label = label.trim(); });
}

export function setParam(id: string, key: string, value: unknown) {
  const s = store.get();
  if (s.mode === 'learn') return setLessonParamFromPart(id, key, value);
  edit((p) => { const part = p.parts.find((q) => q.id === id); if (part) part.params = { ...part.params, [key]: value }; });
}

/* ---------------- wires ---------------- */

export function canConnect(a: TermRef, b: TermRef): string | null {
  if (termKey(a) === termKey(b)) return 'A wire needs two different ends.';
  if (store.get().project.wires.some((w) => (termKey(w.a) === termKey(a) && termKey(w.b) === termKey(b)) || (termKey(w.a) === termKey(b) && termKey(w.b) === termKey(a)))) return 'Those two points are already wired together.';
  return null;
}

export function addWire(a: TermRef, b: TermRef, color?: string) {
  const why = canConnect(a, b);
  if (why) { toast(why); return null; }
  const id = uid('w');
  edit((p) => { p.wires.push({ id, a, b, color: color ?? store.get().wireColor }); });
  return id;
}

export function deleteWire(id: string) {
  edit((p) => { p.wires = p.wires.filter((w) => w.id !== id); });
  store.set({ selection: null });
}

export function setWireColor(id: string, color: string) {
  edit((p) => { const w = p.wires.find((x) => x.id === id); if (w) w.color = color; });
}

export const terminalName = (t: TermRef, project = store.get().project) => {
  if (t.part === BOARD_PART_ID) {
    const pin = DOIT_DEVKIT_V1.pins.find((p) => p.id === t.term);
    return pin ? (pin.gpio != null ? `ESP32 ${pin.label} (GPIO${pin.gpio})` : `ESP32 ${pin.label}`) : t.term;
  }
  const part = project.parts.find((p) => p.id === t.part);
  const term = part && getDef(part.type).terminals.find((d) => d.id === t.term);
  return part && term ? `${part.label} ${term.label}` : `${t.part}.${t.term}`;
};

/* ---------------- program ---------------- */

export function setProgram(program: Program) {
  edit((p) => { p.program = program; });
}

/**
 * Sketch edits from the code editor: saved with the project, but kept off the undo stack (the editor has its own
 * undo) and not uploaded: the board keeps running the sketch it has until Run uploads the new one.
 */
export function setSketch(source: string) {
  const p = { ...store.get().project, firmware: { source }, updatedAt: Date.now() };
  store.set({ project: p });
  if (store.get().mode === 'build') autosave(p);
}

/** Switch what runs on the board. Going to code starts from the sketch equivalent to the behaviour rules. */
export function setRunMode(mode: 'code' | 'rules') {
  if ((store.get().project.runMode ?? 'rules') === mode) return;
  stop();
  edit((p) => {
    p.runMode = mode;
    if (mode === 'code' && !p.firmware) p.firmware = { source: p.program.rules.length ? generateSketch(p.program, p.name) : STARTER_SKETCH };
  });
  toast(mode === 'code' ? 'This project now runs the Arduino sketch in the Code tab.' : 'This project now runs its behaviour rules.');
}

export function renameProject(name: string) {
  edit((p) => { p.name = name.trim() || 'Untitled project'; }, { record: false });
}

/* ---------------- projects ---------------- */

function openOnBench(p: Project, mode: Mode, saved: boolean) {
  past = []; future = [];
  store.set((s) => ({ mode, project: p, saved, selection: null, canUndo: false, canRedo: false, fitToken: s.fitToken + 1, rightTab: mode === 'build' ? 'inspector' : 'overview', centerTab: 'build' }));
  loadProject(p);
}

export function newBlankProject() {
  const p = blankSketchProject();
  saveProject(p);
  setCurrentId(p.id);
  openOnBench(p, 'build', true);
  toast('New blank project: drag parts from the catalogue onto the bench.');
}

export function openTemplate(id: string) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return;
  const p = t.build();
  saveProject(p);
  setCurrentId(p.id);
  openOnBench(p, 'build', true);
  toast(`Opened "${t.name}" as your own copy. Changes save automatically.`);
}

export function openSaved(id: string) {
  const p = listProjects().find((x) => x.id === id);
  if (!p) { toast('That project is no longer in this browser.'); return; }
  setCurrentId(p.id);
  openOnBench(p, 'build', true);
}

export function importProject(p: Project) {
  const copy = { ...p, id: uid('p'), updatedAt: Date.now() };
  saveProject(copy);
  setCurrentId(copy.id);
  openOnBench(copy, 'build', true);
  toast(`Imported "${copy.name}".`);
}

export function duplicateProject() {
  const src = store.get().project;
  const p = { ...cloneProject(src), id: uid('p'), name: `${src.name} (copy)`, createdAt: Date.now(), updatedAt: Date.now() };
  saveProject(p);
  setCurrentId(p.id);
  openOnBench(p, 'build', true);
  toast(`Duplicated as "${p.name}".`);
}

export function removeSaved(id: string) {
  deleteProject(id);
  if (store.get().project.id === id) newBlankProject();
}

/** Copy the lesson's circuit into a new Build project the learner owns. */
export function openLessonInBuild() {
  const src = store.get().project;
  const lesson = currentLesson();
  const p = { ...cloneProject(src), id: uid('p'), name: `${lesson.title} (from lesson)`, createdAt: Date.now(), updatedAt: Date.now() };
  saveProject(p);
  setCurrentId(p.id);
  openOnBench(p, 'build', true);
  toast('Copied the lesson circuit into Build. Rewire it, add parts, change the behaviour.');
}

/* ---------------- modes & lessons ---------------- */

export const currentLesson = (): Lesson => LESSONS.find((l) => l.id === store.get().lessonId) ?? LESSONS[0];

export function setMode(mode: Mode) {
  const s = store.get();
  if (s.mode === mode) return;
  if (mode === 'learn') {
    if (s.mode === 'build') lastBuildProject = s.project;
    openLesson(s.lessonId);
  } else {
    const id = getCurrentId();
    const saved = (id && listProjects().find((p) => p.id === id)) || lastBuildProject;
    if (saved) openOnBench(saved, 'build', true);
    else newBlankProject();
  }
}

export function openLesson(id: string) {
  const lesson = LESSONS.find((l) => l.id === id) ?? LESSONS[0];
  const values = { ...lesson.defaults };
  store.set({ lessonId: lesson.id, lessonValues: values, lessonStep: firstOpenStep(lesson), stepStartValues: values });
  openOnBench(lesson.build(values), 'learn', false);
}

function firstOpenStep(lesson: Lesson) {
  const done = store.get().progress.lessons[lesson.id]?.done ?? [];
  const i = lesson.steps.findIndex((_, k) => !done.includes(k));
  return i < 0 ? 0 : i;
}

export function setLessonValue(key: string, value: unknown) {
  const lesson = currentLesson();
  const values = { ...store.get().lessonValues, [key]: value };
  const p = lesson.build(values);
  store.set({ lessonValues: values, project: p });
  // a different sketch on a real board means a fresh upload: reset and run again
  reupload(p);
}

/** Inspector edits on a lesson part map onto the lesson's parameters (e.g. the resistor value). */
function setLessonParamFromPart(id: string, key: string, value: unknown) {
  const lesson = currentLesson();
  const map: Record<string, string> = { 'r1.ohms': 'ohms', 'led1.color': 'color' };
  const lk = map[`${id}.${key}`];
  if (lk && lesson.params.some((p) => p.key === lk)) setLessonValue(lk, value);
  else toast('In a lesson the circuit is fixed. Open it in Build to change anything.');
}

export function gotoStep(i: number) {
  const lesson = currentLesson();
  store.set({ lessonStep: Math.max(0, Math.min(lesson.steps.length - 1, i)), stepStartValues: { ...store.get().lessonValues } });
}

export function markStepDone(i: number) {
  const s = store.get();
  const lesson = currentLesson();
  const entry = s.progress.lessons[lesson.id] ?? { done: [], completed: false };
  if (entry.done.includes(i)) return;
  const done = [...entry.done, i];
  const completed = done.length >= lesson.steps.length;
  const progress = { lessons: { ...s.progress.lessons, [lesson.id]: { done, completed } } };
  store.set({ progress });
  saveProgress(progress);
  if (completed) toast(`Lesson complete: ${lesson.title}!`);
}

export function resetProgress() {
  const progress = { lessons: {} };
  store.set({ progress });
  saveProgress(progress);
}
