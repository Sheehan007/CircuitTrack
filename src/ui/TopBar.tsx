import { store, useApp } from '../app/store';
import * as A from '../app/actions';
import * as H from '../app/host';
import { Icon, fmtTime } from './common';

const SPEEDS = [0.25, 0.5, 1, 2, 5, 10];

const FW_TEXT: Record<string, string> = {
  'reset-held': 'Held in reset (EN low)',
  download: 'Download mode (BOOT held at reset)',
  'boot-failed': 'Boot failed',
};

/** One state for the whole board: Stopped, Compiling, Running, Paused or Error (plus the hardware boot states). */
function useBoardState(): { cls: string; text: string; detail?: string } {
  const run = useApp((s) => s.run);
  const fw = useApp((s) => s.snap?.firmware ?? 'none');
  const info = useApp((s) => s.snap?.fw);
  const compile = useApp((s) => s.compile);
  if (compile.status === 'compiling') return { cls: 'compiling', text: 'Compiling…' };
  if (fw === 'crashed') return { cls: 'error', text: `Error · crashed at line ${info?.fault?.line ?? '?'}`, detail: info?.fault?.message };
  if (compile.fromRun && compile.status === 'error' && run === 'idle') return { cls: 'error', text: 'Error · did not compile', detail: compile.diagnostics.find((d) => d.severity === 'error')?.message };
  if (FW_TEXT[fw]) return { cls: fw, text: FW_TEXT[fw] };
  if (fw === 'running' && run === 'running') return { cls: 'running', text: info && !info.realtime ? 'Running · slower than real time' : 'Running', detail: info && !info.realtime ? 'The page cannot keep up with real time, so simulated time runs slower. Nothing is skipped.' : undefined };
  if (run === 'paused' && fw !== 'none') return { cls: 'paused', text: 'Paused' };
  return { cls: 'stopped', text: 'Stopped' };
}

export function TopBar() {
  const mode = useApp((s) => s.mode);
  const run = useApp((s) => s.run);
  const speed = useApp((s) => s.speed);
  const t = useApp((s) => s.snap?.t ?? 0);
  const board = useBoardState();
  const runMode = useApp((s) => s.project.runMode ?? 'rules');
  const fw = useApp((s) => s.snap?.firmware ?? 'none');
  const name = useApp((s) => s.project.name);
  const canUndo = useApp((s) => s.canUndo);
  const canRedo = useApp((s) => s.canRedo);
  const errors = useApp((s) => s.snap?.issues.filter((i) => i.severity === 'error').length ?? 0);

  return (
    <header class="topbar">
      <div class="brand">
        <svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect x="6" y="5" width="20" height="22" rx="2" fill="#2c323d" stroke="#231e16" stroke-width="2" /><rect x="10" y="8" width="12" height="10" rx="1" fill="#e9ecec" stroke="#231e16" stroke-width="1.5" />{[9, 13, 17, 21, 25].map((y) => <g key={y}><rect x="2" y={y - 1} width="4" height="2" fill="#d8ac4a" /><rect x="26" y={y - 1} width="4" height="2" fill="#d8ac4a" /></g>)}</svg>
        <div>
          <h1>ESP32 Lab</h1>
          <span class="tagline">learn · build · experiment</span>
        </div>
      </div>
      <nav class="modes" aria-label="Mode">
        <button class={mode === 'learn' ? 'on' : ''} aria-pressed={mode === 'learn'} onClick={() => A.setMode('learn')}><Icon name="book" /> Learn</button>
        <button class={mode === 'build' ? 'on' : ''} aria-pressed={mode === 'build'} onClick={() => A.setMode('build')}><Icon name="wrench" /> Build</button>
      </nav>
      {mode === 'build' && (
        <div class="project-name">
          <label class="sr-only" for="pname">Project name</label>
          <input id="pname" value={name} onChange={(e) => A.renameProject((e.target as HTMLInputElement).value)} />
          <button class="icon-btn" disabled={!canUndo} onClick={A.undo} title="Undo (Ctrl+Z)" aria-label="Undo"><Icon name="undo" /></button>
          <button class="icon-btn" disabled={!canRedo} onClick={A.redo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Icon name="redo" /></button>
        </div>
      )}
      <div class="sim-controls" role="group" aria-label="Simulation">
        <button class={`run ${run === 'running' ? 'on' : ''}`} onClick={H.toggleRun} title="Run / pause (Space when the bench isn't focused)">
          <Icon name={run === 'running' ? 'pause' : 'play'} /> {run === 'running' ? 'Pause' : run === 'paused' ? 'Resume' : 'Run'}
        </button>
        <button class="icon-btn" onClick={H.step} title="Step to the next event" aria-label="Step to the next event"><Icon name="step" /></button>
        <button class="icon-btn" onClick={H.stop} disabled={run === 'idle' && fw === 'none'} title="Stop: nothing runs, every pin goes back to high-Z" aria-label="Stop"><Icon name="stop" /></button>
        <button class="icon-btn" onClick={H.reset} title="Reset: start again from t = 0 (deterministic)" aria-label="Reset simulation"><Icon name="reset" /></button>
        <label class="speed">
          <span class="sr-only">Speed</span>
          <select value={String(speed)} onChange={(e) => store.set({ speed: Number((e.target as HTMLSelectElement).value) })} aria-label="Simulation speed">
            {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
        <div class="clock" aria-live="off">
          <span class={`fw fw-${board.cls}`} title={board.detail}>{board.text}</span>
          <span class="t">t = {fmtTime(t)}</span>
        </div>
        {errors > 0 && <button class="err-badge" onClick={() => store.set({ bottomTab: 'checks' })} title="Open checks">{errors} error{errors > 1 ? 's' : ''}</button>}
      </div>
      {mode === 'build' && runMode === 'code'
        ? <p class="sim-note" title="Your sketch is compiled by ESP32 Lab to its own bytecode and executed against the simulated circuit. It is not compiled for, or run on, an emulated Xtensa CPU; only the supported subset of the Arduino API is available.">Runs your sketch · Arduino C++ subset</p>
        : <p class="sim-note" title="ESP32 Lab models the circuit and runs a behaviour you describe. Lessons and behaviour rules do not compile or execute firmware.">Simulated behaviour · not firmware</p>}
    </header>
  );
}
