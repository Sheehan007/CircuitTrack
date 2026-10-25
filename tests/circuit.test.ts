import { describe, expect, it } from 'vitest';
import { DOIT_DEVKIT_V1 } from '../src/sim/boards/doitDevkitV1';
import { buildNetlist, rotLocal, terminalWorld } from '../src/sim/netlist';
import { blankProject } from '../src/sim/project';
import { Engine } from '../src/sim/engine';
import { buttonLed } from '../src/content/templates';
import { codes, has } from './helpers';

describe('board profile', () => {
  const B = DOIT_DEVKIT_V1;
  it('has the 30 header pins in DOIT order', () => {
    expect(B.pins).toHaveLength(30);
    expect(B.pins.filter((p) => p.side === 'left').map((p) => p.label)).toEqual(['EN', 'VP', 'VN', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'D13', 'GND', 'VIN']);
    expect(B.pins.filter((p) => p.side === 'right').map((p) => p.label)).toEqual(['D23', 'D22', 'TX0', 'RX0', 'D21', 'D19', 'D18', 'D5', 'TX2', 'RX2', 'D4', 'D2', 'D15', 'GND', '3V3']);
    expect(B.pins.filter((p) => p.kind === 'gpio')).toHaveLength(25);
  });
  it('marks GPIO34–39 input-only without pulls, and the strapping pins', () => {
    for (const g of [34, 35, 36, 39]) {
      const p = B.pins.find((x) => x.gpio === g)!;
      expect(p.caps.digitalOut).toBe(false);
      expect(p.caps.pullUp).toBe(false);
    }
    expect(B.pins.filter((p) => p.roles.includes('strapping')).map((p) => p.gpio).sort((a, b) => a! - b!)).toEqual([2, 5, 12, 15]);
    expect(B.pins.find((p) => p.gpio === 25)!.caps.dac).toBe(1);
    expect(B.pins.find((p) => p.gpio === 32)!.caps.adc).toEqual({ unit: 1, channel: 4 });
  });
});

describe('netlist', () => {
  it('joins the two GND pins as net 0 and keeps tactile switch leg pairs joined', () => {
    const p = buttonLed();
    const nl = buildNetlist(p, DOIT_DEVKIT_V1);
    expect(nl.netOf.get('esp32:GND_L')).toBe(0);
    expect(nl.netOf.get('esp32:GND_R')).toBe(0);
    expect(nl.netOf.get('btn1:1a')).toBe(nl.netOf.get('btn1:1b'));
    expect(nl.netOf.get('btn1:1a')).toBe(nl.netOf.get('esp32:GPIO4'));
    expect(nl.netOf.get('btn1:2a')).toBe(0);
    expect(nl.netOf.get('led1:K')).toBe(0);
    expect(nl.nets[nl.netOf.get('esp32:GPIO23')!].name).toBe('GPIO23');
  });

  it('rotates terminals with their part', () => {
    expect(rotLocal([1, 0, 0], 1)).toEqual([-0, 1, 0]);
    const p = buttonLed();
    p.parts[0] = { ...p.parts[0], x: 10, y: 20, rot: 2 };
    expect(terminalWorld(p, DOIT_DEVKIT_V1, { part: 'btn1', term: '1a' })).toEqual([10 + 3.81, 20 + 2.54, 0.4]);
  });

  it('flags a supply shorted to ground and a GPIO tied to a supply', () => {
    const p = blankProject();
    p.wires.push({ id: 'x', a: { part: 'esp32', term: '3V3' }, b: { part: 'esp32', term: 'GND_L' }, color: '#000' });
    expect(has(new Engine(p), 'short-circuit')).toBe(true);
    const q = blankProject();
    q.program.pins[23] = 'OUTPUT';
    q.wires.push({ id: 'x', a: { part: 'esp32', term: 'GPIO23' }, b: { part: 'esp32', term: 'GND_R' }, color: '#000' });
    const e = new Engine(q);
    expect(e.snapshot().issues.find((i) => i.code === 'gpio-to-supply')?.severity).toBe('error');
  });

  it('flags OUTPUT on an input-only pin and UART0 pins', () => {
    const p = blankProject();
    p.program.pins[34] = 'OUTPUT';
    p.program.pins[1] = 'OUTPUT';
    const c = codes(new Engine(p));
    expect(c).toContain('input-only-output');
    expect(c).toContain('uart0-pin');
  });
});
