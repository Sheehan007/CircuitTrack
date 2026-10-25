import { useEffect, useState } from 'preact/hooks';
import { store, useApp } from '../app/store';
import * as A from '../app/actions';
import * as H from '../app/host';
import { resetProgress } from '../app/actions';
import { saveSettings } from '../app/storage';
import { TopBar } from './TopBar';
import { Stage } from './Stage';
import { Inspector } from './Inspector';
import { BottomPanels } from './BottomPanels';
import { PinoutPanel } from './PinoutPanel';
import { BuildCode, LessonCode } from './CodeView';
import { Catalogue } from './build/Catalogue';
import { ProjectsPanel } from './build/ProjectsPanel';
import { BehaviourEditor } from './build/BehaviourEditor';
import { LessonOverview, LessonPanel } from './learn/LessonPanel';
import { Icon, Tabs } from './common';
import { CodeWorkspace } from './code/CodeWorkspace';
import { Reference } from './code/Reference';

function Toast() {
  const t = useApp((s) => s.toast);
  const [shown, setShown] = useState<typeof t>(null);
  useEffect(() => {
    if (!t) return;
    setShown(t);
    const id = setTimeout(() => setShown(null), 3200);
    return () => clearTimeout(id);
  }, [t?.id]);
  return <div class={`toast${shown ? ' show' : ''}`} role="status" aria-live="polite">{shown?.text}</div>;
}

function RightPanel() {
  const mode = useApp((s) => s.mode);
  const tab = useApp((s) => s.rightTab);
  const runMode = useApp((s) => s.project.runMode ?? 'rules');
  const lessonPins = mode === 'learn' ? A.currentLesson().pins : undefined;
  const tabs = mode === 'learn'
    ? [{ id: 'overview', label: 'Overview' }, { id: 'code', label: 'Code' }, { id: 'pinout', label: 'Pinout' }, { id: 'inspector', label: 'Inspector' }] as const
    : runMode === 'code'
      ? [{ id: 'inspector', label: 'Inspector' }, { id: 'reference', label: 'Reference' }, { id: 'pinout', label: 'Pinout' }, { id: 'behaviour', label: 'Behaviour' }] as const
      : [{ id: 'inspector', label: 'Inspector' }, { id: 'behaviour', label: 'Behaviour' }, { id: 'code', label: 'Code' }, { id: 'pinout', label: 'Pinout' }] as const;
  const value = tabs.some((t) => t.id === tab) ? tab : tabs[0].id;
  return (
    <aside class="right" aria-label="Details">
      <Tabs label="Details" value={value} onChange={(rightTab) => store.set({ rightTab })} tabs={tabs as any} />
      <div class="panel-body" role="tabpanel">
        {value === 'overview' && <LessonOverview />}
        {value === 'inspector' && <Inspector />}
        {value === 'behaviour' && (runMode === 'code' ? <CodeModeBehaviour /> : <BehaviourEditor />)}
        {value === 'code' && (mode === 'learn' ? <LessonCode /> : <BuildCode />)}
        {value === 'reference' && <Reference />}
        {value === 'pinout' && <PinoutPanel only={lessonPins && [...lessonPins, '3V3', 'VIN', 'GND_L']} />}
      </div>
    </aside>
  );
}

function CodeModeBehaviour() {
  return (
    <div class="notice small">
      <p>This project runs the Arduino sketch in the <b>Code</b> tab, so behaviour rules are not used.</p>
      <p class="fineprint">Prefer building with rules instead of code? You can switch back; your sketch is kept with the project.</p>
      <button class="btn" onClick={() => A.setRunMode('rules')}>Run behaviour rules instead</button>
    </div>
  );
}

/** Build mode's middle area: the bench or the sketch editor (both stay mounted, so neither loses its state). */
function Center() {
  const mode = useApp((s) => s.mode);
  const tab = useApp((s) => s.centerTab);
  const runMode = useApp((s) => s.project.runMode ?? 'rules');
  const errs = useApp((s) => s.compile.diagnostics.filter((d) => d.severity === 'error').length);
  const [codeOpened, setCodeOpened] = useState(false);
  const showCode = mode === 'build' && tab === 'code';
  useEffect(() => { if (showCode) setCodeOpened(true); }, [showCode]);
  return (
    <div class={`center${mode === 'build' ? ' with-tabs' : ''}`} id="bench">
      {mode === 'build' && (
        <div class="center-tabs">
          <Tabs label="Workspace" value={tab} onChange={(centerTab) => store.set({ centerTab })} tabs={[
            { id: 'build', label: <><Icon name="board" size={14} /> Build</> },
            { id: 'code', label: <><Icon name="code" size={14} /> Code {errs > 0 && <span class="count err">{errs}</span>}</> },
          ]} />
          <span class={`run-mode ${runMode}`} title={runMode === 'code' ? 'The board runs your Arduino sketch (compiled to ESP32 Lab bytecode).' : 'The board runs behaviour rules (no code is executed).'}>
            {runMode === 'code' ? 'Runs: Arduino sketch' : 'Runs: behaviour rules'}
          </span>
        </div>
      )}
      <div class="center-main">
        <div class="center-pane" hidden={showCode}><Stage /></div>
        {mode === 'build' && codeOpened && <div class="center-pane" hidden={!showCode}><CodeWorkspace visible={showCode} /></div>}
      </div>
      <BottomPanels />
    </div>
  );
}

function LeftPanel() {
  const mode = useApp((s) => s.mode);
  const [tab, setTab] = useState<'parts' | 'projects'>('parts');
  if (mode === 'learn') return <aside class="left" aria-label="Lessons"><LessonPanel /></aside>;
  return (
    <aside class="left" aria-label="Parts and projects">
      <Tabs label="Build" value={tab} onChange={setTab} tabs={[{ id: 'parts', label: 'Parts' }, { id: 'projects', label: 'Projects' }]} />
      <div class="panel-body" role="tabpanel">{tab === 'parts' ? <Catalogue /> : <ProjectsPanel />}</div>
    </aside>
  );
}

function SettingsMenu() {
  const settings = useApp((s) => s.settings);
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<typeof settings>) => store.set({ settings: { ...settings, ...patch } });
  return (
    <div class="settings">
      <button class="link small" aria-expanded={open} onClick={() => setOpen(!open)}>Settings</button>
      {open && (
        <div class="settings-pop" role="dialog" aria-label="Settings">
          <label class="check"><input type="checkbox" checked={settings.wobble} onChange={(e) => set({ wobble: (e.target as HTMLInputElement).checked })} /> Hand-drawn wobble</label>
          <label class="field">Theme
            <select value={settings.theme} onChange={(e) => set({ theme: (e.target as HTMLSelectElement).value as 'auto' })}><option value="auto">Match system</option><option value="light">Light</option><option value="dark">Dark</option></select>
          </label>
          <button class="btn danger" onClick={() => { if (confirm('Clear your lesson progress?')) resetProgress(); }}>Reset lesson progress</button>
          <p class="fineprint">Illustrations are drawn with the <a href="https://april-zhu.com/colorfigures" target="_blank" rel="noreferrer">Colorfigures</a> engine (MIT).</p>
        </div>
      )}
    </div>
  );
}

function FootNote() {
  const mode = useApp((s) => s.mode);
  const runMode = useApp((s) => s.project.runMode ?? 'rules');
  return mode === 'build' && runMode === 'code'
    ? <span>ESP32 Lab compiles a subset of Arduino C++ to its own bytecode and runs it on a simulated circuit. It is not ESP32 machine code; real hardware can differ.</span>
    : <span>ESP32 Lab simulates circuit behaviour for learning. Lessons and behaviour rules do not run firmware, and real hardware can differ.</span>;
}

export function App() {
  const settings = useApp((s) => s.settings);
  const mode = useApp((s) => s.mode);
  const lessonId = useApp((s) => s.lessonId);

  useEffect(() => { saveSettings(settings); document.documentElement.dataset.theme = settings.theme; }, [settings]);
  useEffect(() => {
    const h = mode === 'learn' ? `#learn/${lessonId}` : '#build';
    if (location.hash !== h) history.replaceState(null, '', h);
  }, [mode, lessonId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = /input|textarea|select/i.test(t.tagName) || t.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z' && !typing && store.get().mode === 'build') { e.preventDefault(); e.shiftKey ? A.redo() : A.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y' && !typing && store.get().mode === 'build') { e.preventDefault(); A.redo(); return; }
      // Space runs/pauses unless the bench or a control has a use for it
      if (e.key === ' ' && !typing && !t.closest('.bench') && t.tagName !== 'BUTTON') { e.preventDefault(); H.toggleRun(); }
    };
    const onHash = () => {
      const m = location.hash.match(/^#learn\/(\w+)/);
      if (m && (store.get().mode !== 'learn' || store.get().lessonId !== m[1])) A.openLesson(m[1]);
      else if (location.hash === '#build' && store.get().mode !== 'build') A.setMode('build');
    };
    addEventListener('keydown', onKey);
    addEventListener('hashchange', onHash);
    return () => { removeEventListener('keydown', onKey); removeEventListener('hashchange', onHash); };
  }, []);

  return (
    <div class={`app mode-${mode}`}>
      <a class="skip" href="#bench">Skip to the bench</a>
      <TopBar />
      <main class="layout">
        <LeftPanel />
        <Center />
        <RightPanel />
      </main>
      <footer class="foot">
        <FootNote />
        <SettingsMenu />
      </footer>
      <Toast />
    </div>
  );
}
