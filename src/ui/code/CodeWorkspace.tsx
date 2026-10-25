import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { editorHooks, store, toast, useApp } from '../../app/store';
import * as A from '../../app/actions';
import * as H from '../../app/host';
import { compileSketch } from '../../sim/firmware/compiler';
import type { Diagnostic } from '../../sim/firmware/diagnostics';
import { SKETCH_EXAMPLES } from '../../content/sketches';
import { generateSketch } from '../../sim/program/codegen';
import { CodeBlock } from '../CodeView';
import { Icon } from '../common';

type Monaco = typeof import('./monacoSetup');

/** The Code tab of Build mode: the sketch editor and its controls. */
export function CodeWorkspace({ visible }: { visible: boolean }) {
  const mode = useApp((s) => s.project.runMode ?? 'rules');
  if (mode !== 'code') return <RulesNotice />;
  return <SketchEditor visible={visible} />;
}

function RulesNotice() {
  const project = useApp((s) => s.project);
  const code = useMemo(() => generateSketch(project.program, project.name), [project.program, project.name]);
  return (
    <div class="code-ws rules">
      <div class="notice">
        <h2>This project runs behaviour rules</h2>
        <p>It was made with the Behaviour tab: the simulator runs those rules, not code. Switch it to code to write and run a real Arduino sketch. You start from the sketch equivalent to the rules, which ESP32 Lab compiles and runs; the circuit stays as it is.</p>
        <button class="btn primary" onClick={() => A.setRunMode('code')}><Icon name="play" size={14} /> Switch to code</button>
      </div>
      <CodeBlock code={code} active={null} label="Sketch equivalent to the behaviour rules" />
    </div>
  );
}

const STATUS: Record<string, string> = { none: '', compiling: 'Compiling…', ok: 'No errors', error: '' };

function SketchEditor({ visible }: { visible: boolean }) {
  const source = useApp((s) => s.project.firmware?.source ?? '');
  const projectId = useApp((s) => s.project.id);
  const compile = useApp((s) => s.compile);
  const run = useApp((s) => s.run);
  const fw = useApp((s) => s.snap?.fw);
  const firmware = useApp((s) => s.snap?.firmware ?? 'none');
  const host = useRef<HTMLDivElement>(null);
  const [m, setM] = useState<Monaco | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const editor = useRef<import('./monacoSetup').monaco.editor.IStandaloneCodeEditor | null>(null);
  const [live, setLive] = useState<Diagnostic[]>([]);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const decorations = useRef<import('./monacoSetup').monaco.editor.IEditorDecorationsCollection | null>(null);
  const pending = useRef(0);
  const checkTimer = useRef(0);

  // load Monaco on first use (it is a large chunk; the rest of the app doesn't need it)
  useEffect(() => {
    let alive = true;
    import('./monacoSetup').then((mod) => { if (alive) { mod.setupArduino(); setM(mod); } }, (e) => setLoadError(String(e)));
    return () => { alive = false; };
  }, []);

  const check = (text: string) => {
    const r = compileSketch(text);
    setLive(r.diagnostics);
    const model = editor.current?.getModel();
    if (m && model) m.setMarkers(model, r.diagnostics);
    return r;
  };

  // create the editor once Monaco is loaded
  useEffect(() => {
    if (!m || !host.current) return;
    const ed = m.monaco.editor.create(host.current, {
      value: source,
      language: 'cpp',
      theme: 'esp32-ink',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      tabSize: 2,
      scrollBeyondLastLine: false,
      renderLineHighlight: 'all',
      fixedOverflowWidgets: true,
      glyphMargin: true,
      ariaLabel: 'Arduino sketch editor',
    });
    editor.current = ed;
    decorations.current = ed.createDecorationsCollection();
    const flush = () => {
      if (!pending.current) return;
      clearTimeout(pending.current);
      pending.current = 0;
      A.setSketch(ed.getValue());
    };
    editorHooks.flush = flush;
    ed.onDidChangeModelContent(() => {
      // save shortly after typing stops; Run and Validate flush first, so they always see the latest text
      clearTimeout(pending.current);
      pending.current = window.setTimeout(flush, 300);
      clearTimeout(checkTimer.current);
      checkTimer.current = window.setTimeout(() => check(ed.getValue()), 450);
    });
    ed.onDidChangeCursorPosition((e) => setCursor({ line: e.position.lineNumber, col: e.position.column }));
    ed.addCommand(m.monaco.KeyMod.CtrlCmd | m.monaco.KeyCode.Enter, () => H.uploadAndRun());
    ed.addCommand(m.monaco.KeyMod.CtrlCmd | m.monaco.KeyCode.KeyS, () => { flush(); toast('Saved with the project (it saves automatically).'); });
    check(source);
    return () => { flush(); editorHooks.flush = () => {}; ed.getModel()?.dispose(); ed.dispose(); editor.current = null; };
  }, [m, projectId]);

  // the project's source changed from outside the editor (an example loaded, undo, another project)
  useEffect(() => {
    const ed = editor.current;
    if (ed && !pending.current && ed.getValue() !== source) { ed.setValue(source); check(source); }
  }, [source]);

  // a failed Run shows its diagnostics in the editor too
  useEffect(() => {
    if (compile.fromRun && compile.status === 'error') { const model = editor.current?.getModel(); if (m && model) m.setMarkers(model, compile.diagnostics); setLive(compile.diagnostics); }
  }, [compile]);

  useEffect(() => { if (visible) editor.current?.layout(); }, [visible]);

  // the line the sketch is executing (only when the editor holds what the board runs) and the line it crashed on
  const uploaded = fw?.uploaded ?? null;
  const inSync = uploaded != null && uploaded === source;
  const execLine = firmware === 'running' && inSync ? fw?.line ?? null : null;
  const faultLine = firmware === 'crashed' && fw?.fault ? fw.fault.line : null;
  useEffect(() => {
    if (!m || !decorations.current) return;
    const ds: import('./monacoSetup').monaco.editor.IModelDeltaDecoration[] = [];
    if (execLine) ds.push({ range: new m.monaco.Range(execLine, 1, execLine, 1), options: { isWholeLine: true, className: 'exec-line', glyphMarginClassName: 'exec-glyph', glyphMarginHoverMessage: { value: 'The sketch is here' } } });
    if (faultLine) ds.push({ range: new m.monaco.Range(faultLine, 1, faultLine, 1), options: { isWholeLine: true, className: 'fault-line', glyphMarginClassName: 'fault-glyph', glyphMarginHoverMessage: { value: fw?.fault?.message ?? '' } } });
    decorations.current.set(ds);
  }, [m, execLine, faultLine]);

  const reveal = (d: Diagnostic) => {
    const ed = editor.current;
    if (!ed) return;
    ed.revealLineInCenter(d.line);
    ed.setPosition({ lineNumber: d.line, column: Math.max(1, d.col) });
    ed.focus();
  };

  const loadExample = (id: string) => {
    const ex = SKETCH_EXAMPLES.find((x) => x.id === id);
    if (!ex) return;
    editorHooks.flush();
    const cur = store.get().project.firmware?.source ?? '';
    if (cur.trim() && cur !== ex.source && !confirm(`Replace the code in the editor with the "${ex.name}" example?\n\nThe circuit on the bench stays as it is. (Ctrl+Z in the editor brings your code back.)`)) return;
    const ed = editor.current;
    if (ed) {
      // through the editor's own edit stack, so undo works
      ed.pushUndoStop();
      ed.executeEdits('example', [{ range: ed.getModel()!.getFullModelRange(), text: ex.source }]);
      ed.pushUndoStop();
      editorHooks.flush();
    } else A.setSketch(ex.source);
    toast(`Loaded the ${ex.name} example: ${ex.summary}`);
  };

  const errors = live.filter((d) => d.severity === 'error'), warnings = live.filter((d) => d.severity === 'warning');
  const running = run === 'running' && firmware === 'running';

  return (
    <div class="code-ws">
      <div class="code-toolbar" role="toolbar" aria-label="Sketch">
        <button class="btn primary" onClick={() => H.uploadAndRun()} disabled={compile.status === 'compiling'} title="Compile, upload and run (Ctrl+Enter)">
          <Icon name="upload" size={14} /> {running ? 'Upload & restart' : 'Run'}
        </button>
        <button class="btn" onClick={H.stop} disabled={run === 'idle' && firmware === 'none'} title="Stop the sketch: every pin goes back to high-Z"><Icon name="stop" size={14} /> Stop</button>
        <button class="btn" onClick={H.reset} disabled={run === 'idle'} title="Restart the uploaded sketch from t = 0 (like pressing EN)"><Icon name="reset" size={14} /> Reset</button>
        <button class="btn" onClick={() => { const r = H.validate(); setLive(r.diagnostics); const model = editor.current?.getModel(); if (m && model) m.setMarkers(model, r.diagnostics); toast(r.ok ? `Compiles: no errors${r.diagnostics.length ? `, ${r.diagnostics.length} warning${r.diagnostics.length > 1 ? 's' : ''}` : ''}.` : `${r.diagnostics.filter((d) => d.severity === 'error').length} error(s): see the list under the editor.`); }} title="Check the sketch without running it">
          <Icon name="check" size={14} /> Validate
        </button>
        <span class="sep" />
        <label class="mini-select">
          <span>Examples</span>
          <select value="" onChange={(e) => { const v = (e.target as HTMLSelectElement).value; (e.target as HTMLSelectElement).value = ''; loadExample(v); }} aria-label="Load an example sketch">
            <option value="">Load…</option>
            {SKETCH_EXAMPLES.map((x) => <option key={x.id} value={x.id} title={x.summary}>{x.name}</option>)}
          </select>
        </label>
        <span class="grow" />
        <span class={`compile-state ${errors.length ? 'err' : compile.status === 'compiling' ? 'busy' : 'ok'}`} aria-live="polite">
          {compile.status === 'compiling' ? STATUS.compiling : errors.length ? `${errors.length} error${errors.length > 1 ? 's' : ''}` : warnings.length ? `${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : STATUS.ok}
        </span>
        <span class="muted mono small">Ln {cursor.line}, Col {cursor.col}</span>
      </div>
      {uploaded != null && !inSync && (firmware === 'running' || firmware === 'crashed') && (
        <div class="code-banner">
          The board is running the version you last uploaded; the editor has changes since.
          <button class="link" onClick={() => H.uploadAndRun()}>Upload &amp; restart</button>
        </div>
      )}
      {firmware === 'crashed' && fw?.fault && (
        <div class="code-banner err" role="alert"><b>Crashed at line {fw.fault.line}:</b> {fw.fault.message}</div>
      )}
      <div class="editor-host" ref={host}>
        {!m && !loadError && <p class="muted pad">Loading the editor…</p>}
        {loadError && <p class="pad">The code editor could not load ({loadError}).</p>}
      </div>
      <div class="problems" aria-label="Problems">
        {live.length === 0 ? (
          <span class="muted">No problems. Ctrl+Enter compiles and runs. Only the supported subset of Arduino C++ runs here: see Reference on the right.</span>
        ) : (
          <ul>
            {live.map((d, i) => (
              <li key={i} class={d.severity}>
                <button class="link" onClick={() => reveal(d)}>
                  <Icon name={d.severity === 'info' ? 'info' : 'warn'} size={13} /> <span class="mono">{d.line}:{d.col}</span> {d.message}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
