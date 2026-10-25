import { useMemo, useRef, useState } from 'preact/hooks';
import { useApp, toast } from '../../app/store';
import * as A from '../../app/actions';
import { exportProject, importProjectFile, listProjects } from '../../app/storage';
import { TEMPLATES } from '../../content/templates';
import { Icon } from '../common';

export function ProjectsPanel() {
  const current = useApp((s) => s.project);
  const saved = useApp((s) => s.saved);
  const [tick, setTick] = useState(0);
  const list = useMemo(() => listProjects(), [tick, current.id, current.updatedAt]);
  const file = useRef<HTMLInputElement>(null);
  const refresh = () => setTick((t) => t + 1);

  const onImport = async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    try { A.importProject(await importProjectFile(f)); refresh(); } catch (err) { toast((err as Error).message); }
  };

  return (
    <div class="projects">
      <section>
        <h3>Start</h3>
        <div class="row wrap">
          <button class="btn" onClick={() => { A.newBlankProject(); refresh(); }} title="An empty bench with a starter sketch">Blank board</button>
          <button class="btn" onClick={() => file.current?.click()}><Icon name="upload" size={14} /> Import…</button>
          <input ref={file} type="file" accept=".json,application/json" hidden onChange={onImport} />
        </div>
      </section>
      {([['Run real code', TEMPLATES.filter((t) => t.code), 'An Arduino sketch, compiled and run on the circuit. Edit it in the Code tab.'],
        ['Behaviour examples', TEMPLATES.filter((t) => !t.code), 'Built from behaviour rules (no code); the Code tab can convert one into a sketch.']] as const).map(([title, list, note]) => (
        <section key={title}>
          <h3>{title}</h3>
          <ul class="tpl-list">
            {list.map((t) => (
              <li key={t.id}>
                <button class="tpl" onClick={() => { A.openTemplate(t.id); refresh(); }}>
                  <strong>{t.name}</strong>
                  <span>{t.summary}</span>
                  <em>{t.parts.join(' · ')}</em>
                </button>
              </li>
            ))}
          </ul>
          <p class="fineprint">{note} Examples open as your own copy.</p>
        </section>
      ))}
      <section>
        <h3>This project</h3>
        <p class="fineprint">{saved ? 'Saved in this browser automatically.' : 'Not saved yet.'}</p>
        <div class="row wrap">
          <button class="btn" onClick={() => { A.duplicateProject(); refresh(); }}><Icon name="copy" size={14} /> Duplicate</button>
          <button class="btn" onClick={() => exportProject(current)}><Icon name="download" size={14} /> Export</button>
        </div>
      </section>
      <section>
        <h3>Saved in this browser</h3>
        {list.length === 0 && <p class="fineprint">Nothing yet.</p>}
        <ul class="saved-list">
          {list.map((p) => (
            <li key={p.id} class={p.id === current.id ? 'current' : ''}>
              <button class="link" onClick={() => A.openSaved(p.id)} aria-current={p.id === current.id}>
                <strong>{p.name}</strong>
                <span>{(p.runMode ?? 'rules') === 'code' ? 'sketch' : 'rules'} · {p.parts.length} parts · {p.wires.length} wires · {new Date(p.updatedAt).toLocaleString()}</span>
              </button>
              <button class="icon-btn danger" aria-label={`Delete ${p.name}`} title="Delete" onClick={() => { if (confirm(`Delete "${p.name}" from this browser? This can't be undone.`)) { A.removeSaved(p.id); refresh(); } }}><Icon name="trash" size={14} /></button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
