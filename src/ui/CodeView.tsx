import { useMemo, useState } from 'preact/hooks';
import { useApp, toast } from '../app/store';
import * as A from '../app/actions';
import { generateSketch } from '../sim/program/codegen';
import { Icon } from './common';

const KW = /\b(void|int|float|bool|const|unsigned|long|char|if|else|return|true|false|for|while|HIGH|LOW|OUTPUT|INPUT|INPUT_PULLUP|INPUT_PULLDOWN|SSD1306_SWITCHCAPVCC|SSD1306_WHITE|DHT22|DHT11)\b/g;

function highlight(line: string) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const ci = line.indexOf('//');
  const code = ci >= 0 ? line.slice(0, ci) : line, comment = ci >= 0 ? line.slice(ci) : '';
  let h = esc(code)
    .replace(/("[^"]*")/g, '<span class="s">$1</span>')
    .replace(/(#include)/g, '<span class="k">$1</span>')
    .replace(KW, '<span class="k">$1</span>')
    .replace(/\b(\d+(\.\d+)?|0x[0-9A-F]+)\b/g, '<span class="n">$1</span>')
    .replace(/\b([a-zA-Z_]\w*)(?=\()/g, '<span class="f">$1</span>');
  if (comment) h += `<span class="c">${esc(comment)}</span>`;
  return h;
}

export function CodeBlock({ code, active, label }: { code: string; active: number | null; label: string }) {
  const lines = useMemo(() => code.replace(/\n$/, '').split('\n').map(highlight), [code]);
  return (
    <pre class="code" aria-label={label} tabIndex={0}>
      {lines.map((h, i) => (
        <div key={i} class={`ln${active === i + 1 ? ' active' : ''}`}><span class="no" aria-hidden="true">{i + 1}</span><code dangerouslySetInnerHTML={{ __html: h || ' ' }} /></div>
      ))}
    </pre>
  );
}

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(() => toast('Code copied.'), () => toast('Copy failed: select the code and copy it manually.'));
}

export function BuildCode() {
  const project = useApp((s) => s.project);
  const code = useMemo(() => generateSketch(project.program, project.name), [project.program, project.name]);
  const [wide, setWide] = useState(false);
  return (
    <div class={`code-panel${wide ? ' wide' : ''}`}>
      <div class="code-bar">
        <span class="badge">Generated · read-only</span>
        <button class="icon-btn" onClick={() => copy(code)} title="Copy" aria-label="Copy code"><Icon name="copy" size={14} /></button>
        <button class="icon-btn" onClick={() => setWide(!wide)} title={wide ? 'Smaller' : 'Larger'} aria-label="Toggle large code view"><Icon name="fit" size={14} /></button>
      </div>
      <p class="fineprint">Arduino-ESP32 core 3.x sketch equivalent to your behaviour rules. The simulator runs the rules, not this code.</p>
      <CodeBlock code={code} active={null} label="Generated Arduino sketch" />
    </div>
  );
}

export function LessonCode() {
  const values = useApp((s) => s.lessonValues);
  const snap = useApp((s) => s.snap);
  const lesson = A.currentLesson();
  const code = lesson.code(values);
  const active = snap && snap.firmware === 'running' ? lesson.highlight(snap.active, snap, values) : null;
  return (
    <div class="code-panel">
      <div class="code-bar">
        <span class="badge">Arduino-ESP32 3.x · read-only</span>
        <button class="icon-btn" onClick={() => copy(code)} title="Copy" aria-label="Copy code"><Icon name="copy" size={14} /></button>
      </div>
      {lesson.params.length > 0 && (
        <div class="lesson-params">
          {lesson.params.map((p) => (
            <label key={p.key} title={p.help}>
              <span>{p.label}</span>
              <select value={String(values[p.key])} onChange={(e) => { const raw = (e.target as HTMLSelectElement).value; const o = p.options.find((x) => String(x.value) === raw); A.setLessonValue(p.key, o ? o.value : raw); }}>
                {p.options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
      <CodeBlock code={code} active={active} label={`${lesson.title} sketch`} />
      <p class="fineprint">The highlighted line is the one the simulated behaviour just performed. Changing a value re-uploads: the board resets and runs the new sketch.</p>
    </div>
  );
}
