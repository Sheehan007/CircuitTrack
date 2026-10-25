import { useEffect, useRef, useState } from 'preact/hooks';
import type { Snapshot } from '../sim/engine';
import type { Project } from '../sim/project';
import type { Diagnostic } from '../sim/firmware/diagnostics';
import { loadProgress, loadSettings, type Progress, type Settings } from './storage';

export type Mode = 'learn' | 'build';
export type RunState = 'idle' | 'running' | 'paused';
export type Selection = { kind: 'part' | 'wire'; id: string } | null;
export type RightTab = 'inspector' | 'behaviour' | 'code' | 'pinout' | 'overview' | 'specs' | 'reference';
export type BottomTab = 'serial' | 'gpio' | 'signals' | 'wiring' | 'checks';
export type CenterTab = 'build' | 'code';

/** Result of the last compile (Run or Validate) of the sketch in the editor. */
export interface CompileState {
  status: 'none' | 'compiling' | 'ok' | 'error';
  diagnostics: Diagnostic[];
  /** The source that was compiled. */
  source: string;
  /** True when this result came from pressing Run (a failed upload), not from live checking while typing. */
  fromRun?: boolean;
}

/** The code editor registers a flush so Run never uploads a stale copy of what is on screen. */
export const editorHooks = { flush: () => {} };

export interface AppState {
  mode: Mode;
  project: Project;
  /** Build mode: is the project on stage stored in the browser? (Lessons are not.) */
  saved: boolean;
  lessonId: string;
  lessonValues: Record<string, any>;
  lessonStep: number;
  stepStartValues: Record<string, any>;
  run: RunState;
  speed: number;
  selection: Selection;
  wireColor: string;
  rightTab: RightTab;
  bottomTab: BottomTab;
  /** Build mode: the bench or the code editor in the middle. */
  centerTab: CenterTab;
  compile: CompileState;
  settings: Settings;
  progress: Progress;
  snap: Snapshot | null;
  toast: { text: string; id: number } | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Bumped when the stage should re-fit its view (new project, rotation). */
  fitToken: number;
}

type Listener = () => void;

class Store {
  state: AppState;
  private listeners = new Set<Listener>();
  constructor(initial: AppState) { this.state = initial; }
  get = () => this.state;
  set = (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  };
  subscribe = (l: Listener) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
}

export let store: Store;

export function initStore(initial: Omit<AppState, 'settings' | 'progress'>) {
  store = new Store({ ...initial, settings: loadSettings(), progress: loadProgress() });
  return store;
}

/** Subscribe a component to part of the state; it re-renders only when the selected value changes. */
export function useApp<T>(select: (s: AppState) => T): T {
  const [, force] = useState(0);
  const ref = useRef<T>(select(store.state));
  ref.current = select(store.state);
  useEffect(() => store.subscribe(() => {
    const next = select(store.state);
    if (!Object.is(next, ref.current)) { ref.current = next; force((n) => n + 1); }
  }), []);
  return ref.current;
}

let toastId = 0;
export const toast = (text: string) => store.set({ toast: { text, id: ++toastId } });

// The store is a module-level singleton: hot-swapping this module would leave components holding a stale one, so a
// change here reloads the page instead (development only).
if (import.meta.hot) import.meta.hot.accept(() => import.meta.hot!.invalidate());
