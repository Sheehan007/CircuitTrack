import { useEffect, useRef } from 'preact/hooks';
import { store, useApp } from '../app/store';
import * as A from '../app/actions';
import { getEngine, interact } from '../app/host';
import { getDef } from '../sim/components/registry';
import type { ParamDef } from '../sim/components/types';
import { DOIT_DEVKIT_V1 } from '../sim/boards/doitDevkitV1';
import { BOARD_PART_ID, type Project } from '../sim/project';
import { termKey, type TermRef } from '../sim/types';
import { stripOf } from '../sim/components/breadboard';
import { Empty, Icon } from './common';

export function Inspector() {
  const sel = useApp((s) => s.selection);
  const project = useApp((s) => s.project);
  if (!sel) return <NothingSelected />;
  if (sel.kind === 'wire') return <WireInspector id={sel.id} project={project} />;
  if (sel.id === BOARD_PART_ID) return <BoardInspector />;
  return <PartInspector id={sel.id} project={project} />;
}

function NothingSelected() {
  const mode = useApp((s) => s.mode);
  const project = useApp((s) => s.project);
  return (
    <div class="inspector">
      <Empty>Select a part or a wire on the bench to inspect it.</Empty>
      <nav aria-label="Everything on the bench">
        <h3>On the bench</h3>
        <ul class="bench-list">
          <li><button class="link" onClick={() => store.set({ selection: { kind: 'part', id: BOARD_PART_ID } })}>ESP32 DOIT DevKit V1</button></li>
          {project.parts.map((p) => <li key={p.id}><button class="link" onClick={() => store.set({ selection: { kind: 'part', id: p.id } })}>{p.label}</button> <small>{getDef(p.type).name}</small></li>)}
        </ul>
      </nav>
      {mode === 'build' && <ul class="tips">
        <li><b>Add parts:</b> drag them from the catalogue, or press Add.</li>
        <li><b>Wire:</b> drag from a pin to another pin (or click one, then the other).</li>
        <li><b>Move:</b> drag a part; arrow keys nudge the selected part by 2.54 mm.</li>
        <li><b>Rotate / duplicate / delete:</b> R, Ctrl+D, Delete.</li>
        <li><b>Undo:</b> Ctrl+Z.</li>
      </ul>}
    </div>
  );
}

function allTerminals(project: Project): { ref: TermRef; name: string; group: string }[] {
  const out = DOIT_DEVKIT_V1.pins.map((p) => ({ ref: { part: BOARD_PART_ID, term: p.id }, name: p.gpio != null ? `${p.label} (GPIO${p.gpio})` : p.label, group: 'ESP32 header' }));
  for (const part of project.parts) for (const t of getDef(part.type).terminals) out.push({ ref: { part: part.id, term: t.id }, name: `${part.label} · ${t.label}`, group: part.label });
  return out;
}

function Connect({ from, project }: { from: TermRef; project: Project }) {
  const mode = useApp((s) => s.mode);
  if (mode !== 'build') return null;
  const opts = allTerminals(project).filter((t) => termKey(t.ref) !== termKey(from));
  const groups = [...new Set(opts.map((o) => o.group))];
  return (
    <select class="connect" aria-label={`Connect ${A.terminalName(from, project)} to…`} value="" onChange={(e) => {
      const v = (e.target as HTMLSelectElement).value;
      if (!v) return;
      const [part, term] = v.split('|');
      A.addWire(from, { part, term });
    }}>
      <option value="">+ wire to…</option>
      {groups.map((g) => <optgroup key={g} label={g}>{opts.filter((o) => o.group === g).map((o) => <option key={termKey(o.ref)} value={`${o.ref.part}|${o.ref.term}`}>{o.name}</option>)}</optgroup>)}
    </select>
  );
}

function ParamField({ partId, def, value }: { partId: string; def: ParamDef; value: any }) {
  const set = (v: unknown) => A.setParam(partId, def.key, v);
  const id = `p-${partId}-${def.key}`;
  if (def.kind === 'select') {
    return (
      <div class="field">
        <label for={id}>{def.label}</label>
        <select id={id} value={String(value)} onChange={(e) => { const raw = (e.target as HTMLSelectElement).value; const o = def.options!.find((x) => String(x.value) === raw); set(o ? o.value : raw); }}>
          {def.options!.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
        </select>
        {def.help && <small>{def.help}</small>}
      </div>
    );
  }
  if (def.kind === 'number') {
    return (
      <div class="field">
        <label for={id}>{def.label} <output>{Number(value).toFixed(def.step && def.step < 1 ? 1 : 0)} {def.unit}</output></label>
        <input id={id} type="range" min={def.min} max={def.max} step={def.step} value={Number(value)} onInput={(e) => set(Number((e.target as HTMLInputElement).value))} />
        {def.help && <small>{def.help}</small>}
      </div>
    );
  }
  if (def.kind === 'boolean') {
    return <label class="field check"><input type="checkbox" checked={!!value} onChange={(e) => set((e.target as HTMLInputElement).checked)} /> {def.label}</label>;
  }
  return (
    <div class="field">
      <label for={id}>{def.label}</label>
      <input id={id} value={String(value ?? '')} onChange={(e) => set((e.target as HTMLInputElement).value)} />
    </div>
  );
}

function PartInspector({ id, project }: { id: string; project: Project }) {
  const snap = useApp((s) => s.snap?.parts[id]);
  const mode = useApp((s) => s.mode);
  const part = project.parts.find((p) => p.id === id);
  if (!part) return <Empty>That part is gone.</Empty>;
  const def = getDef(part.type);
  const params = { ...def.defaults, ...part.params } as Record<string, any>;
  const wires = project.wires;
  const config = def.params.filter((p) => p.group === 'config');
  const env = def.params.filter((p) => p.group === 'environment');
  const pressed = !!(snap?.visual as any)?.pressed;
  return (
    <div class="inspector">
      <header class="insp-head">
        {mode === 'build'
          ? <input class="part-name" aria-label="Part name" value={part.label} onChange={(e) => A.renamePart(id, (e.target as HTMLInputElement).value)} />
          : <h2>{part.label}</h2>}
        <span class="kind">{def.name}</span>
      </header>
      <p class="summary">{def.summary}</p>
      <p class="sr-only">{def.alt(params)}</p>

      {def.interactions?.map((ia) => (
        <div class="interact" key={ia.key}>
          <button class={`press ${pressed ? 'on' : ''}`} aria-pressed={pressed}
            onPointerDown={() => interact(id, ia.key, true)} onPointerUp={() => !store.get().snap?.parts[id]?.visual.latched && interact(id, ia.key, false)} onPointerLeave={() => pressed && interact(id, ia.key, false)}
            onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); interact(id, ia.key, true); } }}
            onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') interact(id, ia.key, false); }}>
            {pressed ? 'Pressed' : `${ia.label} (hold)`}
          </button>
          <label class="check"><input type="checkbox" checked={pressed} onChange={(e) => interact(id, ia.key, (e.target as HTMLInputElement).checked)} /> keep held down</label>
          <small>{ia.help}</small>
        </div>
      ))}

      {env.length > 0 && <section><h3>Environment</h3>{env.map((p) => <ParamField key={p.key} partId={id} def={p} value={params[p.key]} />)}</section>}
      {snap?.readings.length ? (
        <section><h3>Live</h3><dl class="readings">{snap.readings.map(([k, v]) => <><dt>{k}</dt><dd>{v}</dd></>)}</dl></section>
      ) : null}
      {part.type === 'ssd1306' && <OledZoom id={id} />}
      {part.type === 'st7735' && <TftZoom id={id} />}
      {config.length > 0 && <section><h3>Configuration</h3>{config.map((p) => <ParamField key={p.key} partId={id} def={p} value={params[p.key]} />)}</section>}

      <section>
        <h3>Pins</h3>
        <ul class="term-list">
          {def.terminals.map((t) => {
            const ref = { part: id, term: t.id };
            const attached = wires.filter((w) => termKey(w.a) === termKey(ref) || termKey(w.b) === termKey(ref));
            const plugged = getEngine().netlist.insertions.find((i) => i.part === id && i.term === t.id);
            return (
              <li key={t.id}>
                <div class="term-head"><strong>{t.label}</strong><small>{t.description}</small></div>
                {attached.map((w) => {
                  const other = termKey(w.a) === termKey(ref) ? w.b : w.a;
                  return (
                    <div class="wired" key={w.id}>
                      <span class="dot" style={{ background: w.color }} />
                      <button class="link" onClick={() => store.set({ selection: { kind: 'wire', id: w.id } })}>→ {A.terminalName(other, project)}</button>
                      {mode === 'build' && <button class="icon-btn danger small" aria-label="Remove this wire" title="Remove wire" onClick={() => A.deleteWire(w.id)}><Icon name="x" size={12} /></button>}
                    </div>
                  );
                })}
                {plugged && <div class="wired"><span class="dot" style={{ background: '#f4f2ec' }} />in {project.parts.find((p) => p.id === plugged.board)?.label} hole {plugged.hole} <small>({stripOf(plugged.hole)})</small></div>}
                {!attached.length && !plugged && <div class="unwired">not connected</div>}
                <Connect from={ref} project={project} />
              </li>
            );
          })}
        </ul>
        {def.internalShorts && <p class="fineprint">Inside the switch, {def.internalShorts.map(([a, b]) => `${a} and ${b}`).join(', and ')} are always connected. Pressing joins the two pairs.</p>}
      </section>

      <section><h3>Specs</h3><dl class="readings">{def.specs(params).map(([k, v]) => <><dt>{k}</dt><dd>{v}</dd></>)}</dl></section>
      {mode === 'build' && (
        <div class="row wrap actions">
          <button class="btn" onClick={() => A.rotatePart(id)}><Icon name="rotr" size={14} /> Rotate</button>
          <button class="btn" onClick={() => A.duplicatePart(id)}><Icon name="copy" size={14} /> Duplicate</button>
          <button class="btn danger" onClick={() => A.deletePart(id)}><Icon name="trash" size={14} /> Delete</button>
        </div>
      )}
    </div>
  );
}

/** What the OLED shows, large and crisp (the bench view is small and drawn at an angle). */
function OledZoom({ id }: { id: string }) {
  const vis = useApp((s) => s.snap?.parts[id]?.visual) as { pixels?: Uint8Array; powered?: boolean; frame?: number } | undefined;
  if (!vis?.pixels) return null;
  const px = vis.pixels;
  let d = '';
  for (let y = 0; y < 64; y++) {
    let run = -1;
    for (let x = 0; x <= 128; x++) {
      const on = x < 128 && px[y * 128 + x];
      if (on && run < 0) run = x;
      if (!on && run >= 0) { d += `M${run} ${y}h${x - run}v1h-${x - run}z`; run = -1; }
    }
  }
  return (
    <section>
      <h3>Screen</h3>
      <svg class="oled-zoom" viewBox="0 0 128 64" role="img" aria-label={vis.powered ? 'Contents of the OLED display' : 'The OLED is off (no power)'} shape-rendering="crispEdges">
        <rect width="128" height="64" fill="#0b0d10" />
        {vis.powered && <path d={d} fill="#e9f2ff" />}
      </svg>
    </section>
  );
}

/** What the TFT shows, pixel-exact. */
function TftZoom({ id }: { id: string }) {
  const vis = useApp((s) => s.snap?.parts[id]?.visual) as { pixels?: Uint8ClampedArray; powered?: boolean; frame?: number; backlight?: number } | undefined;
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !vis?.pixels) return;
    const g = cv.getContext('2d');
    if (!g) return;
    const img = g.createImageData(128, 160);
    if (vis.powered) img.data.set(vis.pixels);
    g.putImageData(img, 0, 0);
  }, [vis?.frame, vis?.powered]);
  if (!vis?.pixels) return null;
  return (
    <section>
      <h3>Screen</h3>
      <canvas ref={ref} width={128} height={160} class="tft-zoom" style={{ opacity: vis.powered ? 0.25 + 0.75 * (vis.backlight ?? 0) : 1 }} role="img" aria-label={vis.powered ? 'Contents of the TFT display' : 'The TFT is off (no power)'} />
      {vis.powered && (vis.backlight ?? 0) < 0.3 && <p class="fineprint">The backlight is off, so the picture is barely visible: wire LED to 3V3.</p>}
    </section>
  );
}

function WireInspector({ id, project }: { id: string; project: Project }) {
  const w = project.wires.find((x) => x.id === id);
  const mode = useApp((s) => s.mode);
  const snap = useApp((s) => s.snap);
  if (!w) return <Empty>That wire is gone.</Empty>;
  const n = getEngine().netlist.netOf.get(termKey(w.a));
  const v = n != null && snap ? snap.netVolts[n] : NaN;
  const netName = n != null && snap ? snap.netNames[n] : '';
  return (
    <div class="inspector">
      <header class="insp-head"><h2>Wire</h2><span class="dot big" style={{ background: w.color }} /></header>
      <dl class="readings">
        <dt>From</dt><dd>{A.terminalName(w.a, project)}</dd>
        <dt>To</dt><dd>{A.terminalName(w.b, project)}</dd>
        <dt>Net</dt><dd>{netName}</dd>
        <dt>Voltage</dt><dd>{Number.isNaN(v) ? 'floating (nothing drives it)' : `${v.toFixed(2)} V`}</dd>
      </dl>
      {mode === 'build' && <>
        <section><h3>Colour</h3>
          <div class="row wrap">{['#e2483d', '#2b2724', '#f2b632', '#3f8ee8', '#43c25c', '#a35fd6', '#f08a24', '#f4f1ea'].map((c) => (
            <button key={c} class={`swatch${w.color === c ? ' on' : ''}`} style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={w.color === c} onClick={() => A.setWireColor(id, c)} />
          ))}</div>
          <p class="fineprint">Colour is for you: red for power and black for ground make circuits easier to read.</p>
        </section>
        <button class="btn danger" onClick={() => A.deleteWire(id)}><Icon name="trash" size={14} /> Delete wire</button>
      </>}
    </div>
  );
}

function BoardInspector() {
  const b = useApp((s) => s.snap?.board);
  const B = DOIT_DEVKIT_V1;
  return (
    <div class="inspector">
      <header class="insp-head"><h2>ESP32 board</h2><span class="kind">{B.name}</span></header>
      <p class="summary">{B.chip}. {B.module} module, {B.usbBridge}. Powered over USB: VIN ≈ 5 V, 3V3 from the on-board regulator.</p>
      <section>
        <h3>Buttons</h3>
        <div class="row wrap">
          <button class={`press ${b?.enDown ? 'on' : ''}`} onPointerDown={() => interact(BOARD_PART_ID, 'en', true)} onPointerUp={() => interact(BOARD_PART_ID, 'en', false)}
            onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); interact(BOARD_PART_ID, 'en', true); } }} onKeyUp={() => interact(BOARD_PART_ID, 'en', false)}>EN (reset)</button>
          <button class={`press ${b?.bootDown ? 'on' : ''}`} onPointerDown={() => interact(BOARD_PART_ID, 'boot', true)} onPointerUp={() => interact(BOARD_PART_ID, 'boot', false)}
            onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); interact(BOARD_PART_ID, 'boot', true); } }} onKeyUp={() => interact(BOARD_PART_ID, 'boot', false)}>BOOT (GPIO0)</button>
        </div>
        <p class="fineprint">EN restarts the sketch. Holding BOOT while pressing EN enters download mode, as on the real board.</p>
      </section>
      <section><h3>Specs</h3><dl class="readings">{B.specs.map(([k, v]) => <><dt>{k}</dt><dd>{v}</dd></>)}</dl></section>
      <p class="fineprint">Open the Pinout tab for every pin's capabilities.</p>
    </div>
  );
}
