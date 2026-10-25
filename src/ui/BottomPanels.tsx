import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { store, useApp } from '../app/store';
import * as A from '../app/actions';
import { clearSerial, getEngine, serialSend } from '../app/host';
import type { NetInfo, NetState } from '../sim/engine';
import { DOIT_DEVKIT_V1 } from '../sim/boards/doitDevkitV1';
import type { Issue } from '../sim/types';
import { Empty, Icon, Tabs, fmtTime } from './common';

export function BottomPanels() {
  const tab = useApp((s) => s.bottomTab);
  const issues = useApp((s) => s.snap?.issues ?? []);
  const errs = issues.filter((i) => i.severity === 'error').length, warns = issues.filter((i) => i.severity === 'warning').length;
  return (
    <section class="bottom" aria-label="Instruments">
      <Tabs label="Instruments" value={tab} onChange={(bottomTab) => store.set({ bottomTab })} tabs={[
        { id: 'serial', label: 'Serial' },
        { id: 'gpio', label: 'GPIO' },
        { id: 'signals', label: 'Signals' },
        { id: 'wiring', label: 'Wiring' },
        { id: 'checks', label: <>Checks {errs + warns > 0 && <span class={`count ${errs ? 'err' : 'warn'}`}>{errs + warns}</span>}</> },
      ]} />
      <div class="bottom-body" role="tabpanel">
        {tab === 'serial' && <Serial />}
        {tab === 'gpio' && <Gpio />}
        {tab === 'signals' && <Signals />}
        {tab === 'wiring' && <Wiring />}
        {tab === 'checks' && <Checks />}
      </div>
    </section>
  );
}

function Serial() {
  const lines = useApp((s) => s.snap?.serial ?? []);
  const ts = useApp((s) => s.settings.timestamps);
  const settings = useApp((s) => s.settings);
  const codeMode = useApp((s) => s.mode === 'build' && (s.project.runMode ?? 'rules') === 'code');
  const running = useApp((s) => s.snap?.firmware === 'running');
  const box = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const [text, setText] = useState('');
  const last = lines[lines.length - 1];
  useEffect(() => { if (follow && box.current) box.current.scrollTop = box.current.scrollHeight; }, [lines.length, last?.text, follow]);
  const send = (e: Event) => {
    e.preventDefault();
    serialSend(text + '\n');
    setText('');
  };
  return (
    <div class="serial-wrap">
      <div class="serial-bar">
        <span>115200 baud</span>
        <label class="check inline"><input type="checkbox" checked={ts} onChange={(e) => store.set({ settings: { ...settings, timestamps: (e.target as HTMLInputElement).checked } })} /> timestamps</label>
        <label class="check inline"><input type="checkbox" checked={follow} onChange={(e) => setFollow((e.target as HTMLInputElement).checked)} /> autoscroll</label>
        <button class="link small" onClick={clearSerial}>clear</button>
      </div>
      <div class="serial" ref={box} role="log" aria-live="polite" aria-label="Serial monitor" tabIndex={0}>
        {lines.length === 0 && <span class="muted">Press Run to boot the board. Output appears here.</span>}
        {lines.map((l, i) => <div key={i} class={`sl ${l.kind}`}>{ts && <span class="ts">{fmtTime(l.t)}</span>}{l.text || ' '}</div>)}
      </div>
      {codeMode && (
        <form class="serial-send" onSubmit={send}>
          <label class="sr-only" for="serial-in">Send to the board</label>
          <input id="serial-in" value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} placeholder={running ? 'Send text to Serial (newline added)…' : 'Run the sketch to send it text'} disabled={!running} autocomplete="off" spellcheck={false} />
          <button class="btn" type="submit" disabled={!running}>Send</button>
        </form>
      )}
    </div>
  );
}

function Gpio() {
  const pins = useApp((s) => s.snap?.pins);
  if (!pins) return null;
  const rows = DOIT_DEVKIT_V1.pins.filter((p) => p.kind === 'gpio').map((p) => pins[p.id]).filter((s) => s.mode !== 'UNSET' || !s.floating || s.fn);
  return (
    <div class="gpio-wrap">
      {rows.length === 0 && <Empty>No pin is in use yet. Configured or wired pins appear here with their live voltage.</Empty>}
      {rows.length > 0 && (
        <table class="gpio">
          <thead><tr><th scope="col">Pin</th><th scope="col">Mode</th><th scope="col">Function</th><th scope="col">Level</th><th scope="col">Voltage</th><th scope="col">Current</th></tr></thead>
          <tbody>{rows.map((s) => {
            const def = DOIT_DEVKIT_V1.pins.find((p) => p.id === s.id)!;
            const lvl = s.pwm != null ? `PWM ${Math.round((s.pwm / 255) * 100)} %` : s.read == null ? 'floating' : s.read ? 'HIGH' : 'LOW';
            return (
              <tr key={s.id}>
                <th scope="row">GPIO{s.gpio} <small>{def.label}</small></th>
                <td>{s.mode === 'UNSET' ? '—' : s.mode}</td>
                <td>{s.fn ?? ''}</td>
                <td><span class={`lvl ${s.read == null ? 'f' : s.read ? 'h' : 'l'}`}>{lvl}</span></td>
                <td>{s.floating ? '—' : `${s.volts.toFixed(2)} V`}</td>
                <td>{s.mode === 'OUTPUT' ? `${s.ma.toFixed(1)} mA` : ''}</td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
    </div>
  );
}

const WINDOWS = [1000, 5000, 10000, 30000];

function Signals() {
  const snap = useApp((s) => s.snap);
  const [win, setWin] = useState(5000);
  if (!snap) return null;
  const h = getEngine().history;
  const t1 = snap.t, t0 = Math.max(0, t1 - win);
  const gpios = [...h.keys()].sort((a, b) => a - b);
  if (!gpios.length) return <Empty>Signals appear here once pins change: outputs the program drives and inputs it reads.</Empty>;
  const valueText = (g: number) => {
    const p = Object.values(snap.pins).find((x) => x.gpio === g);
    if (!p) return '';
    if (p.toneHz != null) return `${Math.round(p.toneHz)} Hz`;
    if (p.servoUs != null) return `${Math.round(p.servoUs)} µs`;
    if (p.pwm != null) return `PWM ${Math.round((p.pwm / 255) * 100)}%`;
    return p.read == null ? 'float' : p.read ? 'HIGH' : 'LOW';
  };
  const W = 600, row = 26;
  return (
    <div class="signals">
      <div class="serial-bar">
        <span>window</span>
        {WINDOWS.map((w) => <button key={w} class={`chip${w === win ? ' on' : ''}`} aria-pressed={w === win} onClick={() => setWin(w)}>{w / 1000} s</button>)}
        <span class="muted">{fmtTime(t0)} – {fmtTime(t1)}</span>
      </div>
      <svg viewBox={`0 0 ${W + 140} ${gpios.length * row + 8}`} class="sig-svg" role="img" aria-label={`Logic levels of GPIO ${gpios.join(', ')} over the last ${win / 1000} seconds`}>
        {gpios.map((g, i) => {
          const pts = h.get(g)!;
          const y0 = 4 + i * row, hi = y0 + 4, lo = y0 + row - 6;
          const x = (t: number) => 70 + ((t - t0) / (t1 - t0 || 1)) * W;
          let d = '';
          let prev = pts.filter((p) => p.t <= t0).pop()?.v ?? pts[0]?.v ?? 0;
          let cx = 70;
          const yy = (v: number) => lo - (lo - hi) * v;
          d = `M${cx} ${yy(prev)}`;
          for (const p of pts) {
            if (p.t <= t0) continue;
            cx = x(p.t);
            d += `H${cx.toFixed(1)}V${yy(p.v).toFixed(1)}`;
            prev = p.v;
          }
          d += `H${70 + W}`;
          return (
            <g key={g}>
              <text x="4" y={lo} class="sig-label">GPIO{g}</text>
              <line x1="70" x2={70 + W} y1={lo} y2={lo} class="sig-base" />
              <path d={d} class="sig" />
              <text x={W + 78} y={lo} class="sig-label">{valueText(g)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const NET_TEXT: Record<NetState, string> = {
  power: 'supply',
  ground: 'ground (0 V)',
  'gpio-high': 'driven HIGH by a GPIO',
  'gpio-low': 'driven LOW by a GPIO',
  'gpio-pwm': 'PWM from a GPIO (average shown)',
  driven: 'driven through parts',
  'pulled-up': 'pulled up (weak, internal)',
  'pulled-down': 'pulled down (weak, internal)',
  'high-z': 'high-Z input: nothing drives it, the level is undefined',
  floating: 'floating: connected to nothing that drives it',
  unknown: 'unknown: the circuit has no solution',
};

function netMembers(net: NetInfo, project = store.get().project) {
  const nl = getEngine().netlist;
  return nl.nets[net.index]?.terms.map((t) => A.terminalName(t, project)) ?? [];
}

function Wiring() {
  const project = useApp((s) => s.project);
  const sel = useApp((s) => s.selection);
  const snap = useApp((s) => s.snap);
  const [view, setView] = useState<'nets' | 'wires'>('nets');
  const nl = useMemo(() => getEngine().netlist, [project]);
  if (!project.wires.length) return <Empty>No wires yet. In Build mode, drag from a pin to another pin.</Empty>;
  // nets that involve a part (the board's unused pins are left out)
  const nets = snap ? snap.nets.filter((n) => nl.nets[n.index]?.terms.some((t) => t.part !== 'esp32')) : [];
  return (
    <div>
      <div class="serial-bar">
        <button class={`chip${view === 'nets' ? ' on' : ''}`} aria-pressed={view === 'nets'} onClick={() => setView('nets')}>Nets ({nets.length})</button>
        <button class={`chip${view === 'wires' ? ' on' : ''}`} aria-pressed={view === 'wires'} onClick={() => setView('wires')}>Wires ({project.wires.length})</button>
        <span class="muted">Each net is one node: everything on it has the same voltage. A resistor's two legs are two nets.</span>
      </div>
      {view === 'nets' && snap && (
        <table class="wiring">
          <thead><tr><th scope="col">Net</th><th scope="col">Connects</th><th scope="col">State</th><th scope="col">Voltage</th></tr></thead>
          <tbody>{nets.map((n) => (
            <tr key={n.index}>
              <th scope="row">{n.name}</th>
              <td class="members">{netMembers(n, project).join(' · ')}</td>
              <td><span class={`net-state ${n.state}`}>{NET_TEXT[n.state]}</span></td>
              <td class="mono">{n.volts == null ? '—' : `${n.volts.toFixed(2)} V`}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {view === 'wires' && (
        <table class="wiring">
          <thead><tr><th scope="col"></th><th scope="col">From</th><th scope="col">To</th><th scope="col">Net</th><th scope="col">State</th></tr></thead>
          <tbody>{project.wires.map((w) => {
            const n = nl.netOf.get(`${w.a.part}:${w.a.term}`);
            const info = n != null && snap ? snap.nets[n] : undefined;
            return (
              <tr key={w.id} class={sel?.kind === 'wire' && sel.id === w.id ? 'sel' : ''}>
                <td><span class="dot" style={{ background: w.color }} /></td>
                <td><button class="link" onClick={() => store.set({ selection: { kind: 'wire', id: w.id }, rightTab: 'inspector' })}>{A.terminalName(w.a, project)}</button></td>
                <td>{A.terminalName(w.b, project)}</td>
                <td>{info?.name ?? ''}</td>
                <td>{info ? <><span class={`net-state ${info.state}`}>{info.volts == null ? info.state : `${info.volts.toFixed(2)} V`}</span></> : ''}</td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
    </div>
  );
}

const SEV_ICON: Record<Issue['severity'], string> = { error: 'warn', warning: 'warn', info: 'info' };

function Checks() {
  const issues = useApp((s) => s.snap?.issues ?? []);
  if (!issues.length) return <p class="all-good"><Icon name="check" /> No problems found in the wiring or the program.</p>;
  const focus = (i: Issue) => {
    if (i.parts?.[0]) store.set({ selection: { kind: 'part', id: i.parts[0] }, rightTab: 'inspector' });
  };
  return (
    <ul class="issues">
      {issues.map((i, k) => (
        <li key={k} class={`issue ${i.severity}`}>
          <span class="sev" aria-label={i.severity}><Icon name={SEV_ICON[i.severity]} size={16} /></span>
          <div>
            <strong>{i.title}</strong>
            <p>{i.detail}</p>
            {i.fix && <p class="fix"><b>Fix:</b> {i.fix}</p>}
            {i.parts?.length ? <button class="link small" onClick={() => focus(i)}>Show the part</button> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

