/*
  Drives the headless engine from the browser: owns the single Engine instance, advances its virtual clock from
  requestAnimationFrame while running, and publishes snapshots to the store (throttled to ~30 per second).

  Each frame gets a wall-clock budget (FRAME_BUDGET_MS): a heavy sketch or circuit slows simulated time down rather
  than freezing the page. In code mode, Run compiles the sketch in the editor, uploads it and boots the board.
*/
import { Engine } from '../sim/engine';
import { compileSketch } from '../sim/firmware/compiler';
import type { Project } from '../sim/project';
import { editorHooks, store, toast, type RunState } from './store';

let engine: Engine;
let raf = 0;
let last = 0;
let lastPublish = 0;
const MAX_FRAME_MS = 100;
const FRAME_BUDGET_MS = 24;

export const getEngine = () => engine;

export function createEngine(p: Project) {
  engine = new Engine(p, { seed: 1 });
  engine.subscribe(() => schedulePublish());
  publish();
}

function publish() {
  lastPublish = performance.now();
  store.set({ snap: engine.snapshot() });
}

let pending = 0;
function schedulePublish() {
  if (pending) return;
  const wait = Math.max(0, 33 - (performance.now() - lastPublish));
  pending = window.setTimeout(() => { pending = 0; publish(); }, wait);
}

// Frames come from requestAnimationFrame, with a timer fallback for when the browser throttles frames (a hidden
// pane, a background tab): the same approach the Colorfigures engine uses.
let fallback = 0;
function frame() {
  cancelAnimationFrame(raf);
  clearTimeout(fallback);
  if (store.get().run !== 'running') return;
  const t = performance.now();
  const dt = Math.max(0, Math.min(MAX_FRAME_MS, t - last));
  last = t;
  engine.advance(dt * store.get().speed, FRAME_BUDGET_MS);
  raf = requestAnimationFrame(frame);
  fallback = window.setTimeout(frame, 50);
}

function setRun(run: RunState) {
  store.set({ run });
  cancelAnimationFrame(raf);
  clearTimeout(fallback);
  if (run === 'running') {
    last = performance.now();
    raf = requestAnimationFrame(frame);
    fallback = window.setTimeout(frame, 50);
  }
}

/** Load a project onto the bench. keepRunning: a wiring/param edit while running carries on (hot swap). */
export function loadProject(p: Project, opts: { keepRunning?: boolean } = {}) {
  if (!engine) return createEngine(p);
  if (opts.keepRunning) {
    engine.setProject(p);
  } else {
    // another project: the old sketch is not on this board
    engine.setProject(p);
    engine.clearUpload();
    engine.reset();
    store.set({ compile: { status: 'none', diagnostics: [], source: '' } });
    setRun('idle');
  }
  publish();
}

export function run() {
  const s = store.get().run;
  if (s === 'running') return;
  // a paused sketch resumes where it was; anything else starts fresh
  if (s === 'paused' && engine.firmware !== 'none' && engine.firmware !== 'crashed') { setRun('running'); publish(); return; }
  if (engine.mode === 'code') { uploadAndRun(); return; }
  if (engine.firmware === 'none') engine.start();
  setRun('running');
  publish();
}

/** Compile the sketch in the editor; on success upload it, reset the board and run. */
export function uploadAndRun() {
  editorHooks.flush();
  const p = store.get().project;
  const source = p.firmware?.source ?? '';
  store.set({ compile: { status: 'compiling', diagnostics: [], source } });
  // let the "Compiling" state paint before the (short) synchronous compile
  setTimeout(() => {
    const r = compileSketch(source);
    if (!r.ok) {
      store.set({ compile: { status: 'error', diagnostics: r.diagnostics, source, fromRun: true }, centerTab: 'code' });
      const n = r.diagnostics.filter((d) => d.severity === 'error').length;
      toast(`Not uploaded: ${n} compile error${n === 1 ? '' : 's'}. See the Code tab.`);
      publish();
      return;
    }
    store.set({ compile: { status: 'ok', diagnostics: r.diagnostics, source, fromRun: true } });
    engine.setProject(store.get().project);
    engine.reset();
    engine.upload(r.program!, source);
    engine.start();
    setRun('running');
    publish();
  }, 16);
}

/** Check the sketch without running it. Returns the diagnostics. */
export function validate() {
  editorHooks.flush();
  const source = store.get().project.firmware?.source ?? '';
  const r = compileSketch(source);
  store.set({ compile: { status: r.ok ? 'ok' : 'error', diagnostics: r.diagnostics, source } });
  return r;
}

/** Stop: the board stops running anything; every pin goes back to high-Z and time to 0. */
export function stop() {
  engine.reset();
  setRun('idle');
  publish();
}

export function pause() {
  if (store.get().run !== 'running') return;
  setRun('paused');
  publish();
}

export function toggleRun() {
  if (store.get().run === 'running') pause(); else run();
}

export function step() {
  if (store.get().run === 'running') setRun('paused');
  if (engine.firmware === 'none') engine.start();
  engine.stepToNext();
  if (store.get().run === 'idle') store.set({ run: 'paused' });
  publish();
}

/** Reset (like the EN button / a power cycle): start again from t = 0, still running if it was. */
export function reset() {
  const was = store.get().run !== 'idle';
  engine.reset();
  if (was) engine.start();
  setRun(was && engine.firmware !== 'none' ? 'running' : 'idle');
  publish();
}

export function serialSend(text: string) {
  engine.serialInput(text);
  publish();
}

export function clearSerial() {
  engine.serial.length = 0;
  publish();
}

/** Re-upload: what changing a lesson's code does on a real board (it resets and runs the new sketch). */
export function reupload(p: Project) {
  const wasRunning = store.get().run !== 'idle';
  engine.setProject(p);
  engine.reset();
  setRun('idle');
  if (wasRunning) run();
  publish();
}

export function interact(partId: string, key: string, value: unknown) {
  engine.interact(partId, key, value);
  publish();
}
