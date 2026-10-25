import { useApp, toast } from '../../app/store';
import * as A from '../../app/actions';
import { getEngine } from '../../app/host';
import { DOIT_DEVKIT_V1 } from '../../sim/boards/doitDevkitV1';
import { getDef } from '../../sim/components/registry';
import { uid, type Project } from '../../sim/project';
import type { Action, ActionBody, CompareOp, Condition, DeviceBinding, PinMode, Program, Rule, Trigger, Value } from '../../sim/program/types';
import { SPRITE_NAMES, spriteLabel } from '../../sim/devices/sprites';
import { FEED_IDS, getFeed } from '../../sim/feeds';
import { Icon } from '../common';

const GPIOS = DOIT_DEVKIT_V1.pins.filter((p) => p.gpio != null);
const MODES: PinMode[] = ['OUTPUT', 'INPUT_PULLUP', 'INPUT', 'INPUT_PULLDOWN'];
const OPS: CompareOp[] = ['==', '!=', '<', '<=', '>', '>='];

/** "GPIO4 (D4) · Button 1": what the pin is wired to, so people pick pins by what is on them. */
function pinLabel(project: Project, gpio: number) {
  const pin = DOIT_DEVKIT_V1.pins.find((p) => p.gpio === gpio)!;
  let wired = '';
  try {
    const nl = getEngine().netlist;
    const net = nl.netOf.get(`esp32:${pin.id}`);
    const others = net != null ? nl.nets[net].terms.filter((t) => t.part !== 'esp32') : [];
    wired = [...new Set(others.map((t) => project.parts.find((p) => p.id === t.part)?.label).filter(Boolean))].join(', ');
  } catch { /* engine not ready */ }
  return `GPIO${gpio}${pin.label !== `D${gpio}` ? ` (${pin.label})` : ''}${wired ? ` · ${wired}` : ''}`;
}

function PinSelect({ value, onChange, project, outputOnly, adcOnly, label, allowNone }: { value: number; onChange: (v: number) => void; project: Project; outputOnly?: boolean; adcOnly?: boolean; label: string; allowNone?: string }) {
  return (
    <select aria-label={label} value={String(value)} onChange={(e) => onChange(Number((e.target as HTMLSelectElement).value))}>
      {allowNone && <option value="-1">{allowNone}</option>}
      {GPIOS.filter((p) => (!outputOnly || p.caps.digitalOut) && (!adcOnly || p.caps.adc)).map((p) => <option key={p.gpio} value={p.gpio}>{pinLabel(project, p.gpio!)}</option>)}
    </select>
  );
}

function Num({ value, onChange, label, min, max, step, width }: { value: number; onChange: (v: number) => void; label: string; min?: number; max?: number; step?: number; width?: number }) {
  return <input type="number" aria-label={label} value={value} min={min} max={max} step={step} style={width ? { width: `${width}px` } : undefined} onChange={(e) => onChange(Number((e.target as HTMLInputElement).value))} />;
}

function Color({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="color" aria-label="Colour" value={value} onChange={(e) => onChange((e.target as HTMLInputElement).value)} class="color" />;
}

function VarInput({ value, vars, onChange }: { value: string; vars: string[]; onChange: (v: string) => void }) {
  return (
    <>
      <input class="var" aria-label="Variable name" list="vars-list" value={value} onChange={(e) => onChange(((e.target as HTMLInputElement).value || 'x').replace(/[^\w]/g, '_'))} />
      <datalist id="vars-list">{vars.map((v) => <option key={v} value={v} />)}</datalist>
    </>
  );
}

function ValueEditor({ v, onChange, project, vars, prog }: { v: Value; onChange: (v: Value) => void; project: Project; vars: string[]; prog: Program }) {
  const lists = Object.keys(prog.lists ?? {});
  const make = (k: Value['kind']): Value => {
    switch (k) {
      case 'num': return { kind: 'num', value: 0 };
      case 'var': return { kind: 'var', name: vars[0] ?? 'x' };
      case 'millis': return { kind: 'millis' };
      case 'random': return { kind: 'random', min: 0, max: 100 };
      case 'feed': return { kind: 'feed', feed: 'btc' };
      case 'listLen': return { kind: 'listLen', list: lists[0] ?? 'lines' };
      case 'analogRead': return { kind: 'analogRead', pin: 34 };
      case 'map': return { kind: 'map', value: { kind: 'analogRead', pin: 34 }, inMin: 0, inMax: 4095, outMin: 0, outMax: 255 };
      default: return { kind: 'digitalRead', pin: 4 };
    }
  };
  return (
    <span class="value-ed">
      <select aria-label="Value kind" value={v.kind} onChange={(e) => onChange(make((e.target as HTMLSelectElement).value as Value['kind']))}>
        <option value="num">number</option><option value="var">variable</option><option value="digitalRead">digitalRead</option><option value="analogRead">analogRead</option>
        <option value="millis">millis()</option><option value="random">random</option><option value="feed">data feed (simulated)</option><option value="listLen">lines in list</option><option value="map">map(…) rescale</option>
      </select>
      {v.kind === 'num' && <Num label="Number" value={v.value} onChange={(value) => onChange({ kind: 'num', value })} />}
      {v.kind === 'var' && <VarInput value={v.name} vars={vars} onChange={(name) => onChange({ kind: 'var', name })} />}
      {v.kind === 'digitalRead' && <PinSelect label="Pin" value={v.pin} project={project} onChange={(pin) => onChange({ ...v, pin })} />}
      {v.kind === 'analogRead' && <PinSelect label="ADC pin" adcOnly value={v.pin} project={project} onChange={(pin) => onChange({ ...v, pin })} />}
      {v.kind === 'random' && <><Num label="Minimum" width={60} value={v.min} onChange={(min) => onChange({ ...v, min })} />–<Num label="Maximum" width={60} value={v.max} onChange={(max) => onChange({ ...v, max })} /></>}
      {v.kind === 'feed' && <select aria-label="Feed" value={v.feed} onChange={(e) => onChange({ kind: 'feed', feed: (e.target as HTMLSelectElement).value })}>{FEED_IDS.map((f) => <option key={f} value={f}>{getFeed(f).label}</option>)}</select>}
      {v.kind === 'map' && <span class="map-ed">(<ValueEditor v={v.value} vars={vars} prog={prog} project={project} onChange={(value) => onChange({ ...v, value })} />
        from <Num label="From minimum" width={56} value={v.inMin} onChange={(inMin) => onChange({ ...v, inMin })} />–<Num label="From maximum" width={64} value={v.inMax} onChange={(inMax) => onChange({ ...v, inMax })} />
        to <Num label="To minimum" width={56} value={v.outMin} onChange={(outMin) => onChange({ ...v, outMin })} />–<Num label="To maximum" width={64} value={v.outMax} onChange={(outMax) => onChange({ ...v, outMax })} />)</span>}
      {v.kind === 'listLen' && <select aria-label="List" value={v.list} onChange={(e) => onChange({ kind: 'listLen', list: (e.target as HTMLSelectElement).value })}>{lists.map((l) => <option key={l}>{l}</option>)}</select>}
    </span>
  );
}

const ACTION_KINDS: [ActionBody['kind'], string, (p: Program) => boolean][] = [
  ['digitalWrite', 'Set a pin HIGH / LOW / toggle', () => true],
  ['pwmWrite', 'Dim or set speed with PWM (analogWrite)', () => true],
  ['servoWrite', 'Move a servo to an angle', () => true],
  ['tone', 'Play a tone (passive buzzer)', () => true],
  ['noTone', 'Stop the tone', () => true],
  ['setVar', 'Set a variable', () => true],
  ['serialPrint', 'Print to the serial monitor', () => true],
  ['readDht', 'Read the DHT sensor', (p) => p.devices.some((d) => d.kind === 'dht')],
  ['readBme', 'Read the BME280', (p) => p.devices.some((d) => d.kind === 'bme280')],
  ['oledClear', 'OLED: clear', (p) => p.devices.some((d) => d.kind === 'ssd1306')],
  ['oledText', 'OLED: write text', (p) => p.devices.some((d) => d.kind === 'ssd1306')],
  ['tftFill', 'TFT: fill the screen', (p) => p.devices.some((d) => d.kind === 'tft')],
  ['tftText', 'TFT: write text', (p) => p.devices.some((d) => d.kind === 'tft')],
  ['tftRect', 'TFT: rectangle', (p) => p.devices.some((d) => d.kind === 'tft')],
  ['tftCircle', 'TFT: circle', (p) => p.devices.some((d) => d.kind === 'tft')],
  ['tftBar', 'TFT: bar gauge', (p) => p.devices.some((d) => d.kind === 'tft')],
  ['tftSprite', 'TFT: draw a picture', (p) => p.devices.some((d) => d.kind === 'tft')],
];

function newAction(kind: ActionBody['kind'], prog: Program): Action {
  const id = uid('a');
  const dev = (k: DeviceBinding['kind']) => prog.devices.find((d) => d.kind === k)?.id ?? k;
  const out = Number(Object.entries(prog.pins).find(([, m]) => m === 'OUTPUT')?.[0] ?? 23);
  switch (kind) {
    case 'digitalWrite': return { id, kind, pin: out, value: 'HIGH' };
    case 'pwmWrite': return { id, kind, pin: out, duty: { kind: 'num', value: 128 } };
    case 'servoWrite': return { id, kind, pin: 13, angle: { kind: 'num', value: 90 } };
    case 'tone': return { id, kind, pin: 25, freq: { kind: 'num', value: 440 }, ms: 200 };
    case 'noTone': return { id, kind, pin: 25 };
    case 'setVar': return { id, kind, name: 'count', op: 'add', value: { kind: 'num', value: 1 } };
    case 'readDht': return { id, kind, device: dev('dht'), temp: 'temp', hum: 'hum' };
    case 'readBme': return { id, kind, device: dev('bme280'), temp: 'temp', hum: 'hum', pres: 'pres' };
    case 'oledClear': return { id, kind, device: dev('ssd1306') };
    case 'oledText': return { id, kind, device: dev('ssd1306'), x: 0, y: 0, size: 1, text: 'Hello!' };
    case 'serialPrint': return { id, kind, text: 'Hello from ESP32' };
    case 'tftFill': return { id, kind, device: dev('tft'), color: '#000000' };
    case 'tftText': return { id, kind, device: dev('tft'), x: 4, y: 4, size: 2, color: '#ffffff', text: 'Hello!' };
    case 'tftRect': return { id, kind, device: dev('tft'), x: 0, y: 0, w: 128, h: 20, color: '#3f8ee8', fill: true };
    case 'tftCircle': return { id, kind, device: dev('tft'), x: 64, y: 80, r: 20, color: '#f4b829', fill: true };
    case 'tftBar': return { id, kind, device: dev('tft'), x: 4, y: 140, w: 120, h: 12, value: { kind: 'var', name: 'temp' }, max: 40, color: '#35d07f' };
    case 'tftSprite': return { id, kind, device: dev('tft'), sprite: 'sun', x: 8, y: 8, scale: 2 };
  }
}

function ActionEditor({ a, onChange, onRemove, onMove, project, prog, vars }: { a: Action; onChange: (a: Action) => void; onRemove: () => void; onMove: (d: number) => void; project: Project; prog: Program; vars: string[] }) {
  const set = (patch: Partial<Action>) => onChange({ ...a, ...patch } as Action);
  const DeviceSel = ({ kind }: { kind: DeviceBinding['kind'] }) => {
    const list = prog.devices.filter((d) => d.kind === kind);
    return (
      <select aria-label="Device" value={(a as { device: string }).device} onChange={(e) => set({ device: (e.target as HTMLSelectElement).value } as Partial<Action>)}>
        {list.map((d) => <option key={d.id} value={d.id}>{project.parts.find((p) => p.id === d.part)?.label ?? d.id}</option>)}
        {!list.length && <option value="">(add a device first)</option>}
      </select>
    );
  };
  const XY = ({ hasSize }: { hasSize?: boolean }) => {
    const b = a as { x: number; y: number; size?: number };
    return <>
      <label class="inline">x<Num label="x" width={52} min={0} value={b.x} onChange={(x) => set({ x } as Partial<Action>)} /></label>
      <label class="inline">y<Num label="y" width={52} min={0} value={b.y} onChange={(y) => set({ y } as Partial<Action>)} /></label>
      {hasSize && <label class="inline">size<select value={String(b.size)} onChange={(e) => set({ size: Number((e.target as HTMLSelectElement).value) } as Partial<Action>)}><option>1</option><option>2</option><option>3</option><option>4</option></select></label>}
    </>;
  };
  let body;
  switch (a.kind) {
    case 'digitalWrite':
      body = <><PinSelect label="Pin" outputOnly value={a.pin} project={project} onChange={(pin) => set({ pin })} />
        <select aria-label="Level" value={a.value} onChange={(e) => set({ value: (e.target as HTMLSelectElement).value as 'HIGH' })}><option>HIGH</option><option>LOW</option><option>TOGGLE</option></select></>;
      break;
    case 'pwmWrite':
      body = <><PinSelect label="Pin" outputOnly value={a.pin} project={project} onChange={(pin) => set({ pin })} /> duty 0–255 <ValueEditor v={a.duty} vars={vars} prog={prog} project={project} onChange={(duty) => set({ duty })} /></>;
      break;
    case 'servoWrite':
      body = <><PinSelect label="Servo signal pin" outputOnly value={a.pin} project={project} onChange={(pin) => set({ pin })} /> angle 0–180° <ValueEditor v={a.angle} vars={vars} prog={prog} project={project} onChange={(angle) => set({ angle })} /></>;
      break;
    case 'tone':
      body = <><PinSelect label="Buzzer pin" outputOnly value={a.pin} project={project} onChange={(pin) => set({ pin })} /> Hz <ValueEditor v={a.freq} vars={vars} prog={prog} project={project} onChange={(freq) => set({ freq })} />
        <label class="inline">for<Num label="Duration in ms" width={64} min={0} value={a.ms} onChange={(ms) => set({ ms: Math.max(0, ms) })} />ms</label></>;
      break;
    case 'noTone':
      body = <PinSelect label="Buzzer pin" outputOnly value={a.pin} project={project} onChange={(pin) => set({ pin })} />;
      break;
    case 'setVar':
      body = <><VarInput value={a.name} vars={vars} onChange={(name) => set({ name })} />
        <select aria-label="Operation" value={a.op} onChange={(e) => set({ op: (e.target as HTMLSelectElement).value as 'set' })}><option value="set">=</option><option value="add">+=</option></select>
        <ValueEditor v={a.value} vars={vars} prog={prog} project={project} onChange={(value) => set({ value })} /></>;
      break;
    case 'readDht':
      body = <><DeviceSel kind="dht" /> → °C in <VarInput value={a.temp} vars={vars} onChange={(temp) => set({ temp })} /> %RH in <VarInput value={a.hum} vars={vars} onChange={(hum) => set({ hum })} /></>;
      break;
    case 'readBme':
      body = <><DeviceSel kind="bme280" /> → °C <VarInput value={a.temp} vars={vars} onChange={(temp) => set({ temp })} /> %RH <VarInput value={a.hum} vars={vars} onChange={(hum) => set({ hum })} /> hPa <VarInput value={a.pres} vars={vars} onChange={(pres) => set({ pres })} /></>;
      break;
    case 'oledClear': body = <DeviceSel kind="ssd1306" />; break;
    case 'oledText':
      body = <><DeviceSel kind="ssd1306" /><XY hasSize /><input class="text" aria-label="Text" value={a.text} onChange={(e) => set({ text: (e.target as HTMLInputElement).value })} /></>;
      break;
    case 'serialPrint':
      body = <input class="text" aria-label="Text to print" value={a.text} onChange={(e) => set({ text: (e.target as HTMLInputElement).value })} />;
      break;
    case 'tftFill': body = <><DeviceSel kind="tft" /><Color value={a.color} onChange={(color) => set({ color })} /></>; break;
    case 'tftText':
      body = <><DeviceSel kind="tft" /><XY hasSize /><Color value={a.color} onChange={(color) => set({ color })} /><input class="text" aria-label="Text" value={a.text} onChange={(e) => set({ text: (e.target as HTMLInputElement).value })} /></>;
      break;
    case 'tftRect':
      body = <><DeviceSel kind="tft" /><XY /><label class="inline">w<Num label="Width" width={52} value={a.w} onChange={(w) => set({ w })} /></label><label class="inline">h<Num label="Height" width={52} value={a.h} onChange={(h) => set({ h })} /></label>
        <Color value={a.color} onChange={(color) => set({ color })} /><label class="check inline"><input type="checkbox" checked={a.fill} onChange={(e) => set({ fill: (e.target as HTMLInputElement).checked })} /> filled</label></>;
      break;
    case 'tftCircle':
      body = <><DeviceSel kind="tft" /><XY /><label class="inline">r<Num label="Radius" width={52} value={a.r} onChange={(r) => set({ r })} /></label>
        <Color value={a.color} onChange={(color) => set({ color })} /><label class="check inline"><input type="checkbox" checked={a.fill} onChange={(e) => set({ fill: (e.target as HTMLInputElement).checked })} /> filled</label></>;
      break;
    case 'tftBar':
      body = <><DeviceSel kind="tft" /><XY /><label class="inline">w<Num label="Width" width={52} value={a.w} onChange={(w) => set({ w })} /></label><label class="inline">h<Num label="Height" width={52} value={a.h} onChange={(h) => set({ h })} /></label>
        value <ValueEditor v={a.value} vars={vars} prog={prog} project={project} onChange={(value) => set({ value })} /> of <Num label="Full scale" width={64} value={a.max} onChange={(max) => set({ max })} /><Color value={a.color} onChange={(color) => set({ color })} /></>;
      break;
    case 'tftSprite':
      body = <><DeviceSel kind="tft" />
        <select aria-label="Picture" value={a.sprite} onChange={(e) => set({ sprite: (e.target as HTMLSelectElement).value })}>
          <optgroup label="Built-in">{SPRITE_NAMES.map((n) => <option key={n} value={n}>{spriteLabel(n)}</option>)}</optgroup>
          {Object.keys(prog.sprites ?? {}).length > 0 && <optgroup label="Your images">{Object.keys(prog.sprites!).map((n) => <option key={n} value={n}>{n}</option>)}</optgroup>}
        </select><XY /><label class="inline">×<select aria-label="Scale" value={String(a.scale)} onChange={(e) => set({ scale: Number((e.target as HTMLSelectElement).value) })}><option>1</option><option>2</option><option>3</option><option>4</option></select></label></>;
      break;
  }
  return (
    <li class="action">
      <span class="akind">{ACTION_KINDS.find(([k]) => k === a.kind)?.[1]}</span>
      <div class="afields">{body}</div>
      <div class="aops">
        <button class="icon-btn small" aria-label="Move up" title="Move up" onClick={() => onMove(-1)}>↑</button>
        <button class="icon-btn small" aria-label="Move down" title="Move down" onClick={() => onMove(1)}>↓</button>
        <button class="icon-btn small danger" aria-label="Remove action" title="Remove" onClick={onRemove}><Icon name="x" size={12} /></button>
      </div>
    </li>
  );
}

function ActionList({ list, onChange, project, prog, vars, label }: { list: Action[]; onChange: (l: Action[]) => void; project: Project; prog: Program; vars: string[]; label: string }) {
  return (
    <>
      <ol class="actions" aria-label={label}>
        {list.map((a, i) => (
          <ActionEditor key={a.id} a={a} project={project} prog={prog} vars={vars}
            onChange={(n) => onChange(list.map((x, j) => (j === i ? n : x)))}
            onRemove={() => onChange(list.filter((_, j) => j !== i))}
            onMove={(d) => { const j = i + d; if (j < 0 || j >= list.length) return; const c = list.slice(); [c[i], c[j]] = [c[j], c[i]]; onChange(c); }} />
        ))}
      </ol>
      <select class="add-action" aria-label={`Add an action to ${label}`} value="" onChange={(e) => {
        const k = (e.target as HTMLSelectElement).value as ActionBody['kind'];
        if (k) onChange([...list, newAction(k, prog)]);
      }}>
        <option value="">+ add action…</option>
        {ACTION_KINDS.filter(([, , ok]) => ok(prog)).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
      </select>
    </>
  );
}

function TriggerEditor({ t, onChange, project }: { t: Trigger; onChange: (t: Trigger) => void; project: Project }) {
  return (
    <div class="trigger">
      <select aria-label="When" value={t.kind} onChange={(e) => {
        const k = (e.target as HTMLSelectElement).value;
        onChange(k === 'start' ? { kind: 'start' } : k === 'every' ? { kind: 'every', ms: 1000 } : { kind: 'pinEdge', pin: 4, edge: 'falling' });
      }}>
        <option value="start">at start (setup)</option><option value="every">every…</option><option value="pinEdge">when a pin changes</option>
      </select>
      {t.kind === 'every' && <>
        <Num label="Interval in milliseconds" min={10} step={10} value={t.ms} onChange={(ms) => onChange({ ...t, ms: Math.max(10, ms) })} /> ms
        <label class="check inline"><input type="checkbox" checked={!!t.immediate} onChange={(e) => onChange({ ...t, immediate: (e.target as HTMLInputElement).checked })} /> also at start</label>
      </>}
      {t.kind === 'pinEdge' && <>
        <PinSelect label="Pin" value={t.pin} project={project} onChange={(pin) => onChange({ ...t, pin })} />
        <select aria-label="Edge" value={t.edge} onChange={(e) => onChange({ ...t, edge: (e.target as HTMLSelectElement).value as 'falling' })}>
          <option value="falling">goes LOW (pressed, with pull-up)</option><option value="rising">goes HIGH (released / motion)</option><option value="change">changes either way</option>
        </select>
      </>}
    </div>
  );
}

function RuleCard({ rule, onChange, onRemove, onMove, project, prog, vars, active }: { rule: Rule; onChange: (r: Rule) => void; onRemove: () => void; onMove: (d: number) => void; project: Project; prog: Program; vars: string[]; active: boolean }) {
  const setCond = (i: number, c: Condition) => onChange({ ...rule, conditions: rule.conditions.map((x, j) => (j === i ? c : x)) });
  return (
    <li class={`rule${rule.enabled ? '' : ' off'}${active ? ' active' : ''}`}>
      <div class="rule-head">
        <input class="rule-name" aria-label="Rule name" value={rule.name} onChange={(e) => onChange({ ...rule, name: (e.target as HTMLInputElement).value })} />
        <label class="check inline" title="Enabled"><input type="checkbox" checked={rule.enabled} onChange={(e) => onChange({ ...rule, enabled: (e.target as HTMLInputElement).checked })} /> on</label>
        <button class="icon-btn small" aria-label="Move rule up" onClick={() => onMove(-1)}>↑</button>
        <button class="icon-btn small" aria-label="Move rule down" onClick={() => onMove(1)}>↓</button>
        <button class="icon-btn small danger" aria-label="Delete rule" onClick={onRemove}><Icon name="trash" size={12} /></button>
      </div>
      <div class="clause"><span class="kw">When</span><TriggerEditor t={rule.trigger} project={project} onChange={(trigger) => onChange({ ...rule, trigger })} /></div>
      <div class="clause"><span class="kw">If</span>
        <div class="conds">
          {rule.conditions.length === 0 && <span class="muted">always</span>}
          {rule.conditions.map((c, i) => (
            <div class="cond" key={i}>
              <ValueEditor v={c.left} vars={vars} prog={prog} project={project} onChange={(left) => setCond(i, { ...c, left })} />
              <select aria-label="Comparison" value={c.op} onChange={(e) => setCond(i, { ...c, op: (e.target as HTMLSelectElement).value as CompareOp })}>{OPS.map((o) => <option key={o}>{o}</option>)}</select>
              <ValueEditor v={c.right} vars={vars} prog={prog} project={project} onChange={(right) => setCond(i, { ...c, right })} />
              <button class="icon-btn small danger" aria-label="Remove condition" onClick={() => onChange({ ...rule, conditions: rule.conditions.filter((_, j) => j !== i) })}><Icon name="x" size={12} /></button>
            </div>
          ))}
          <button class="link small" onClick={() => onChange({ ...rule, conditions: [...rule.conditions, { left: { kind: 'digitalRead', pin: rule.trigger.kind === 'pinEdge' ? rule.trigger.pin : 4 }, op: '==', right: { kind: 'num', value: 0 } }] })}>+ condition</button>
        </div>
      </div>
      <div class="clause"><span class="kw">Then</span><div class="grow"><ActionList label="then" list={rule.actions} project={project} prog={prog} vars={vars} onChange={(actions) => onChange({ ...rule, actions })} /></div></div>
      {rule.conditions.length > 0 && <div class="clause"><span class="kw">Else</span><div class="grow"><ActionList label="else" list={rule.elseActions} project={project} prog={prog} vars={vars} onChange={(elseActions) => onChange({ ...rule, elseActions })} /></div></div>}
    </li>
  );
}

/** Reads an image file and turns it into a small sprite (max 64 px on its longest side). */
async function imageToSprite(file: File): Promise<{ w: number; h: number; px: string[] }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That file is not an image the browser can read.')); i.src = url; });
    const k = Math.min(1, 64 / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d')!;
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const px: string[] = [];
    for (let i = 0; i < w * h; i++) px.push(d[i * 4 + 3] < 128 ? '' : '#' + [0, 1, 2].map((c) => d[i * 4 + c].toString(16).padStart(2, '0')).join(''));
    return { w, h, px };
  } finally { URL.revokeObjectURL(url); }
}

function ListsEditor({ prog, set }: { prog: Program; set: (p: Partial<Program>) => void }) {
  const lists = prog.lists ?? {};
  return (
    <section>
      <h3>Text lists <small>(lyrics, messages)</small></h3>
      {Object.entries(lists).map(([name, lines]) => (
        <div class="list-ed" key={name}>
          <div class="row"><code>{name}</code><span class="muted">{lines.length} lines · use {`{${name}[i]}`} in text</span>
            <button class="icon-btn small danger" aria-label={`Delete list ${name}`} onClick={() => { const l = { ...lists }; delete l[name]; set({ lists: l }); }}><Icon name="x" size={12} /></button></div>
          <textarea aria-label={`Lines of ${name}`} rows={Math.min(8, Math.max(3, lines.length + 1))} value={lines.join('\n')} onChange={(e) => set({ lists: { ...lists, [name]: (e.target as HTMLTextAreaElement).value.split('\n').filter((l) => l.length) } })} />
        </div>
      ))}
      <button class="link small" onClick={() => { let n = 'lines', k = 1; while (lists[n]) n = `lines${++k}`; set({ lists: { ...lists, [n]: ['First line', 'Second line'] } }); }}>+ text list</button>
    </section>
  );
}

function SpritesEditor({ prog, set }: { prog: Program; set: (p: Partial<Program>) => void }) {
  const sprites = prog.sprites ?? {};
  return (
    <section>
      <h3>Pictures for the TFT</h3>
      <p class="fineprint">Built-in: {SPRITE_NAMES.map(spriteLabel).join(', ')}. You can add your own image: it is shrunk to at most 64 px.</p>
      <ul class="sprite-list">{Object.entries(sprites).map(([n, s]) => (
        <li key={n}><code>{n}</code> {s.w}×{s.h}<button class="icon-btn small danger" aria-label={`Delete picture ${n}`} onClick={() => { const c = { ...sprites }; delete c[n]; set({ sprites: c }); }}><Icon name="x" size={12} /></button></li>
      ))}</ul>
      <label class="btn small-btn">Add an image…<input type="file" accept="image/*" hidden onChange={async (e) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        (e.target as HTMLInputElement).value = '';
        if (!f) return;
        try {
          const sp = await imageToSprite(f);
          let name = f.name.replace(/\.[^.]+$/, '').replace(/[^\w]/g, '_').slice(0, 20) || 'image';
          while (sprites[name] || SPRITE_NAMES.includes(name)) name += '_';
          set({ sprites: { ...sprites, [name]: sp } });
          toast(`Added picture "${name}" (${sp.w}×${sp.h}).`);
        } catch (err) { toast((err as Error).message); }
      }} /></label>
    </section>
  );
}

export function BehaviourEditor() {
  const project = useApp((s) => s.project);
  const activeRule = useApp((s) => (s.snap?.active && s.snap.t - s.snap.active.t < 250 ? s.snap.active.ruleId : null));
  const prog = project.program;
  const set = (p: Partial<Program>) => A.setProgram({ ...prog, ...p });
  const vars = [...new Set([...prog.vars.map((v) => v.name), ...prog.rules.flatMap((r) => [...r.actions, ...r.elseActions].flatMap((a) => a.kind === 'readDht' ? [a.temp, a.hum] : a.kind === 'readBme' ? [a.temp, a.hum, a.pres] : a.kind === 'setVar' ? [a.name] : []))])];
  const partsOf = (device: string) => project.parts.filter((p) => getDef(p.type).device === device);
  const usedPins = Object.keys(prog.pins).map(Number);
  const freePin = GPIOS.find((p) => !usedPins.includes(p.gpio!) && p.caps.digitalOut && !p.roles.length)?.gpio ?? 23;
  const setDev = (i: number, d: DeviceBinding) => set({ devices: prog.devices.map((x, j) => (j === i ? d : x)) });
  const newId = (base: string) => { let id = base, k = 1; while (prog.devices.some((d) => d.id === id)) id = `${base}${++k}`; return id; };
  const PartSel = ({ d, i, device }: { d: DeviceBinding; i: number; device: string }) => (
    <select aria-label="Part" value={d.part} onChange={(e) => { const part = (e.target as HTMLSelectElement).value; const type = project.parts.find((p) => p.id === part)?.type; setDev(i, d.kind === 'dht' ? { ...d, part, model: type === 'dht11' ? 'DHT11' : 'DHT22' } : { ...d, part } as DeviceBinding); }}>
      {partsOf(device).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}{!partsOf(device).some((p) => p.id === d.part) && <option value={d.part}>{d.part} (missing)</option>}
    </select>
  );
  const usesI2c = prog.devices.some((d) => d.kind === 'ssd1306' || d.kind === 'bme280');

  return (
    <div class="behaviour">
      <p class="fineprint">A behaviour is a simple stand-in for firmware: set-up, then rules that fire on events. ESP32 Lab simulates it on the circuit you wired; the Code tab shows the equivalent Arduino sketch.</p>
      <section>
        <h3>Pin set-up <small>(pinMode)</small></h3>
        <ul class="pin-modes">
          {Object.entries(prog.pins).map(([g, m]) => (
            <li key={g}>
              <PinSelect label="Pin" value={Number(g)} project={project} onChange={(n) => { const pins = { ...prog.pins }; delete pins[Number(g)]; pins[n] = m; set({ pins }); }} />
              <select aria-label="Mode" value={m} onChange={(e) => set({ pins: { ...prog.pins, [g]: (e.target as HTMLSelectElement).value as PinMode } })}>{MODES.map((x) => <option key={x}>{x}</option>)}</select>
              <button class="icon-btn small danger" aria-label={`Remove GPIO${g}`} onClick={() => { const pins = { ...prog.pins }; delete pins[Number(g)]; set({ pins }); }}><Icon name="x" size={12} /></button>
            </li>
          ))}
        </ul>
        <button class="link small" onClick={() => set({ pins: { ...prog.pins, [freePin]: 'OUTPUT' } })}>+ pin</button>
        <p class="fineprint">Servos and tones claim their pin automatically, like ESP32Servo's attach() and tone() do.</p>
      </section>

      <section>
        <h3>Devices</h3>
        <ul class="devices">
          {prog.devices.map((d, i) => (
            <li key={d.id}>
              {d.kind === 'dht' && <><span class="dev-kind">DHT</span><PartSel d={d} i={i} device="dht" /> on <PinSelect label="Data pin" outputOnly value={d.pin} project={project} onChange={(pin) => setDev(i, { ...d, pin })} /></>}
              {(d.kind === 'ssd1306' || d.kind === 'bme280') && <><span class="dev-kind">{d.kind === 'ssd1306' ? 'OLED' : 'BME280'}</span><PartSel d={d} i={i} device={d.kind} /> at
                <select aria-label="I²C address" value={String(d.address)} onChange={(e) => setDev(i, { ...d, address: Number((e.target as HTMLSelectElement).value) })}>
                  {(d.kind === 'ssd1306' ? [0x3c, 0x3d] : [0x76, 0x77]).map((a) => <option key={a} value={a}>0x{a.toString(16).toUpperCase()}</option>)}
                </select></>}
              {d.kind === 'tft' && <><span class="dev-kind">TFT</span><PartSel d={d} i={i} device="tft" />
                CS <PinSelect label="CS pin" outputOnly value={d.cs} project={project} onChange={(cs) => setDev(i, { ...d, cs })} />
                DC <PinSelect label="DC pin" outputOnly value={d.dc} project={project} onChange={(dc) => setDev(i, { ...d, dc })} />
                RESET <PinSelect label="RESET pin" outputOnly allowNone="tied to 3V3" value={d.rst} project={project} onChange={(rst) => setDev(i, { ...d, rst })} /></>}
              <code class="dev-id">{d.id}</code>
              <button class="icon-btn small danger" aria-label="Remove device" onClick={() => set({ devices: prog.devices.filter((_, j) => j !== i) })}><Icon name="x" size={12} /></button>
            </li>
          ))}
        </ul>
        <div class="row wrap">
          {([['dht', '+ DHT sensor'], ['ssd1306', '+ OLED'], ['bme280', '+ BME280'], ['tft', '+ TFT']] as const).map(([k, label]) => {
            const parts = partsOf(k);
            return <button key={k} class="link small" disabled={!parts.length} title={parts.length ? '' : 'Add that part to the bench first'} onClick={() => {
              const part = parts[0];
              const dev: DeviceBinding = k === 'dht' ? { id: newId('dht'), kind: 'dht', part: part.id, model: part.type === 'dht11' ? 'DHT11' : 'DHT22', pin: 4 }
                : k === 'tft' ? { id: newId('tft'), kind: 'tft', part: part.id, cs: 5, dc: 2, rst: 4 }
                : { id: newId(k === 'ssd1306' ? 'oled' : 'bme'), kind: k, part: part.id, address: Number(part.params.address ?? getDef(part.type).defaults.address) };
              set({ devices: [...prog.devices, dev] });
            }}>{label}</button>;
          })}
        </div>
        {usesI2c && (
          <div class="i2c">I²C pins: SDA <PinSelect label="SDA" outputOnly value={prog.i2c.sda} project={project} onChange={(sda) => set({ i2c: { ...prog.i2c, sda } })} />
            SCL <PinSelect label="SCL" outputOnly value={prog.i2c.scl} project={project} onChange={(scl) => set({ i2c: { ...prog.i2c, scl } })} /></div>
        )}
        {prog.devices.some((d) => d.kind === 'tft') && <p class="fineprint">The TFT uses hardware SPI: SCK = GPIO18, SDA (MOSI) = GPIO23.</p>}
      </section>

      <section>
        <h3>Rules</h3>
        {prog.rules.length === 0 && <p class="muted">No rules yet. Start from one of these:</p>}
        <ol class="rules">
          {prog.rules.map((r, i) => (
            <RuleCard key={r.id} rule={r} project={project} prog={prog} vars={vars} active={activeRule === r.id}
              onChange={(n) => set({ rules: prog.rules.map((x, j) => (j === i ? n : x)) })}
              onRemove={() => set({ rules: prog.rules.filter((_, j) => j !== i) })}
              onMove={(d) => { const j = i + d; if (j < 0 || j >= prog.rules.length) return; const c = prog.rules.slice(); [c[i], c[j]] = [c[j], c[i]]; set({ rules: c }); }} />
          ))}
        </ol>
        <div class="row wrap">
          <button class="btn" onClick={() => set({ rules: [...prog.rules, { id: uid('r'), name: 'Every second', enabled: true, trigger: { kind: 'every', ms: 1000 }, conditions: [], actions: [], elseActions: [] }] })}>+ Every…</button>
          <button class="btn" onClick={() => {
            const pin = Number(Object.entries(prog.pins).find(([, m]) => m.startsWith('INPUT'))?.[0] ?? 4);
            set({ pins: prog.pins[pin] ? prog.pins : { ...prog.pins, [pin]: 'INPUT_PULLUP' }, rules: [...prog.rules, { id: uid('r'), name: 'When the button is pressed', enabled: true, trigger: { kind: 'pinEdge', pin, edge: 'falling' }, conditions: [], actions: [], elseActions: [] }] });
          }}>+ When pressed…</button>
          <button class="btn" onClick={() => set({ rules: [...prog.rules, { id: uid('r'), name: 'At start', enabled: true, trigger: { kind: 'start' }, conditions: [], actions: [], elseActions: [] }] })}>+ At start…</button>
        </div>
        <p class="fineprint">In text, <code>{'{temp}'}</code> inserts a variable, <code>{'{temp:1}'}</code> rounds it to one decimal, and <code>{'{lines[i]}'}</code> prints line i of a text list.</p>
      </section>
      <ListsEditor prog={prog} set={set} />
      {prog.devices.some((d) => d.kind === 'tft') && <SpritesEditor prog={prog} set={set} />}
    </div>
  );
}
