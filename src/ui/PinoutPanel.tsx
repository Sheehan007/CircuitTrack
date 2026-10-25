import { useState } from 'preact/hooks';
import { useApp } from '../app/store';
import { DOIT_DEVKIT_V1 } from '../sim/boards/doitDevkitV1';
import type { PinDef } from '../sim/boards/types';

const FILTERS: [string, string, (p: PinDef) => boolean][] = [
  ['all', 'All', () => true],
  ['safe', 'Safe to use', (p) => p.kind === 'gpio' && !p.roles.length],
  ['adc', 'ADC', (p) => !!p.caps.adc],
  ['touch', 'Touch', (p) => p.caps.touch != null],
  ['dac', 'DAC', (p) => !!p.caps.dac],
  ['input', 'Input only', (p) => p.roles.includes('input-only')],
  ['strap', 'Strapping', (p) => p.roles.includes('strapping')],
  ['power', 'Power', (p) => p.kind !== 'gpio'],
];

export function PinoutPanel({ only }: { only?: string[] }) {
  const [f, setF] = useState('all');
  const pins = useApp((s) => s.snap?.pins);
  const filt = FILTERS.find((x) => x[0] === f)![2];
  const list = DOIT_DEVKIT_V1.pins.filter((p) => (!only || only.includes(p.id)) && filt(p));
  return (
    <div class="pinout">
      {!only && (
        <div class="chips" role="group" aria-label="Filter pins">
          {FILTERS.map(([id, label]) => <button key={id} class={`chip${f === id ? ' on' : ''}`} aria-pressed={f === id} onClick={() => setF(id)}>{label}</button>)}
        </div>
      )}
      <table class="pin-table">
        <thead><tr><th scope="col">Pin</th><th scope="col">GPIO</th><th scope="col">Can do</th><th scope="col">Now</th></tr></thead>
        <tbody>
          {list.map((p) => {
            const s = pins?.[p.id];
            const caps = [
              p.caps.digitalOut ? 'I/O' : p.kind === 'gpio' ? 'in only' : '',
              p.caps.adc ? `ADC${p.caps.adc.unit}_${p.caps.adc.channel}` : '',
              p.caps.touch != null ? `T${p.caps.touch}` : '',
              p.caps.dac ? `DAC${p.caps.dac}` : '',
              ...p.defaults,
            ].filter(Boolean);
            return (
              <tr key={p.id} class={p.roles.length ? 'careful' : ''}>
                <th scope="row">{p.label}<small>{p.side === 'left' ? 'L' : 'R'}{p.index + 1}</small></th>
                <td>{p.gpio ?? '—'}</td>
                <td>
                  <div class="caps">{caps.map((c) => <span key={c} class="cap">{c}</span>)}{p.roles.map((r) => <span key={r} class={`cap role-${r}`}>{r}</span>)}</div>
                  <small>{p.notes[0]}</small>
                </td>
                <td class="now">{s ? (p.kind === 'gpio' ? (s.floating ? 'float' : `${s.volts.toFixed(2)} V`) : p.kind === 'ground' ? '0 V' : `${s.volts.toFixed(2)} V`) : ''}{s?.fn ? <small>{s.fn}</small> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p class="fineprint">Sources: <a href={DOIT_DEVKIT_V1.sources[0]} target="_blank" rel="noreferrer">DOIT pinout (Mischianti)</a>, <a href={DOIT_DEVKIT_V1.sources[1]} target="_blank" rel="noreferrer">espboards.dev</a>, <a href={DOIT_DEVKIT_V1.sources[2]} target="_blank" rel="noreferrer">ESP-IDF GPIO reference</a>.</p>
    </div>
  );
}
