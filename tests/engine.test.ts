import { describe, expect, it } from 'vitest';
import { Engine } from '../src/sim/engine';
import { VirtualClock } from '../src/sim/clock';
import { blinkLesson, buttonLesson } from '../src/content/lessons';
import { blankProject } from '../src/sim/project';
import { act, rule } from '../src/content/templates';
import { has, run, serialText } from './helpers';

describe('virtual clock', () => {
  it('runs events in time order, ties in scheduling order', () => {
    const c = new VirtualClock();
    const seen: string[] = [];
    c.schedule(20, () => seen.push('b'));
    c.schedule(10, () => seen.push('a'));
    c.schedule(20, () => seen.push('c'));
    c.advance(15);
    expect(seen).toEqual(['a']);
    expect(c.now).toBe(15);
    c.advance(10);
    expect(seen).toEqual(['a', 'b', 'c']);
  });
});

describe('blink lesson', () => {
  const project = blinkLesson.build(blinkLesson.defaults);

  it('is idle until Run: the LED is dark and the pin unconfigured', () => {
    const e = new Engine(project);
    const s = e.snapshot();
    expect(s.firmware).toBe('none');
    expect(s.pins.GPIO23.mode).toBe('UNSET');
    expect(s.parts.led1.visual.brightness).toBe(0);
  });

  it('boots, prints a boot log and blinks every 500 ms', () => {
    const e = run(project);
    expect(serialText(e)).toContain('rst:0x1 (POWERON_RESET)');
    e.advance(0); // start rules fire at t=0
    expect(e.snapshot().pins.GPIO23.level).toBe(1);
    expect(e.snapshot().parts.led1.visual.brightness as number).toBeGreaterThan(0.3);
    e.advance(500);
    expect(e.snapshot().pins.GPIO23.level).toBe(0);
    expect(e.snapshot().parts.led1.visual.brightness).toBe(0);
    e.advance(2000);
    expect((e.history.get(23) ?? []).length).toBe(6);
  });

  it('LED current follows the resistor (≈4.8 mA at 220 Ω, ≈1.2 mA at 1 kΩ)', () => {
    const at = (ohms: number) => {
      const e = run(blinkLesson.build({ ...blinkLesson.defaults, ohms }));
      e.advance(0);
      return e.snapshot().parts.led1.visual.ma as number;
    };
    expect(at(220)).toBeCloseTo(4.78, 1);
    expect(at(1000)).toBeCloseTo(1.24, 1);
  });

  it('code and behaviour use the same delay', () => {
    const v = { ...blinkLesson.defaults, delay: 250 };
    expect(blinkLesson.code(v)).toContain('delay(250);');
    const r = blinkLesson.build(v).program.rules[0];
    expect(r.trigger).toMatchObject({ kind: 'every', ms: 250 });
  });

  it('is deterministic and reset returns to t = 0', () => {
    const a = run(project, 3210), b = run(project, 3210);
    expect(a.snapshot().pins).toEqual(b.snapshot().pins);
    expect(serialText(a)).toBe(serialText(b));
    a.reset();
    const s = a.snapshot();
    expect(s.t).toBe(0);
    expect(s.firmware).toBe('none');
    expect(s.serial).toHaveLength(0);
    a.start();
    a.advance(3210);
    expect(a.snapshot().pins).toEqual(b.snapshot().pins);
  });

  it('warns when the LED has no resistor', () => {
    const p = blinkLesson.build(blinkLesson.defaults);
    p.parts = p.parts.filter((x) => x.id !== 'r1');
    p.wires = [
      { id: 'a', a: { part: 'esp32', term: 'GPIO23' }, b: { part: 'led1', term: 'A' }, color: '#f00' },
      { id: 'b', a: { part: 'led1', term: 'K' }, b: { part: 'esp32', term: 'GND_R' }, color: '#000' },
    ];
    const e = run(p);
    e.advance(0);
    expect(e.snapshot().pins.GPIO23.ma).toBeGreaterThan(20);
    expect(has(e, 'gpio-current-high')).toBe(true);
  });

  it('EN held LOW keeps the chip in reset; releasing it reboots', () => {
    const e = run(project, 100);
    e.interact('esp32', 'en', true);
    expect(e.firmware).toBe('reset-held');
    expect(e.snapshot().pins.GPIO23.mode).toBe('UNSET');
    e.interact('esp32', 'en', false);
    expect(e.firmware).toBe('running');
    expect(serialText(e).match(/POWERON_RESET/g)!.length).toBe(2);
  });

  it('BOOT held during reset enters download mode', () => {
    const e = run(project, 10);
    e.interact('esp32', 'boot', true);
    e.interact('esp32', 'en', true);
    e.interact('esp32', 'en', false);
    expect(e.firmware).toBe('download');
    expect(serialText(e)).toContain('waiting for download');
  });
});

describe('button lesson', () => {
  it('hold mode: LED is on only while the button is held', () => {
    const e = run(buttonLesson.build({ mode: 'hold' }), 50);
    const s0 = e.snapshot();
    expect(s0.pins.GPIO4.volts).toBeCloseTo(3.3, 1);
    expect(s0.pins.GPIO4.read).toBe(1);
    e.interact('btn1', 'pressed', true);
    e.advance(1);
    expect(e.snapshot().pins.GPIO4.read).toBe(0);
    expect(e.snapshot().parts.led1.visual.brightness as number).toBeGreaterThan(0.2);
    e.interact('btn1', 'pressed', false);
    e.advance(1);
    expect(e.snapshot().parts.led1.visual.brightness).toBe(0);
  });

  it('toggle mode: each press flips the LED', () => {
    const e = run(buttonLesson.build({ mode: 'toggle' }), 50);
    const press = () => { e.interact('btn1', 'pressed', true); e.advance(20); e.interact('btn1', 'pressed', false); e.advance(20); };
    press();
    expect(e.snapshot().pins.GPIO23.level).toBe(1);
    press();
    expect(e.snapshot().pins.GPIO23.level).toBe(0);
  });

  it('a floating input is reported when the pull-up is removed', () => {
    const p = buttonLesson.build({ mode: 'hold' });
    p.program.pins[4] = 'INPUT';
    const e = run(p, 10);
    expect(e.snapshot().pins.GPIO4.floating).toBe(true);
    expect(has(e, 'floating-input')).toBe(true);
  });
});

describe('blank project: button → LED built from scratch', () => {
  it('places, wires, programs and runs', () => {
    const p = blankProject('From scratch');
    p.parts.push(
      { id: 'b', type: 'button', label: 'Button 1', x: 0, y: -40, rot: 0, params: {} },
      { id: 'l', type: 'led', label: 'LED 1', x: -10, y: -40, rot: 0, params: { color: 'yellow' } },
      { id: 'r', type: 'resistor', label: 'R 1', x: -20, y: -40, rot: 0, params: { ohms: 330 } },
    );
    p.wires.push(
      { id: '1', a: { part: 'b', term: '1a' }, b: { part: 'esp32', term: 'GPIO18' }, color: '#ff0' },
      { id: '2', a: { part: 'b', term: '2a' }, b: { part: 'esp32', term: 'GND_L' }, color: '#000' },
      { id: '3', a: { part: 'esp32', term: 'GPIO19' }, b: { part: 'r', term: '1' }, color: '#00f' },
      { id: '4', a: { part: 'r', term: '2' }, b: { part: 'l', term: 'A' }, color: '#00f' },
      { id: '5', a: { part: 'l', term: 'K' }, b: { part: 'esp32', term: 'GND_R' }, color: '#000' },
    );
    p.program.pins = { 18: 'INPUT_PULLUP', 19: 'OUTPUT' };
    p.program.rules.push(rule({ name: 'press → on', trigger: { kind: 'pinEdge', pin: 18, edge: 'falling' }, actions: [act({ kind: 'digitalWrite', pin: 19, value: 'HIGH' })] }));
    p.program.rules.push(rule({ name: 'release → off', trigger: { kind: 'pinEdge', pin: 18, edge: 'rising' }, actions: [act({ kind: 'digitalWrite', pin: 19, value: 'LOW' })] }));
    const e = run(p, 10);
    expect(e.snapshot().issues.filter((i) => i.severity === 'error')).toEqual([]);
    e.interact('b', 'pressed', true);
    e.advance(1);
    expect(e.snapshot().parts.l.visual.brightness as number).toBeGreaterThan(0);
    e.interact('b', 'pressed', false);
    e.advance(1);
    expect(e.snapshot().parts.l.visual.brightness).toBe(0);
  });

  it('wiring a button leg pair the wrong way keeps the input permanently LOW', () => {
    const p = blankProject();
    p.parts.push({ id: 'b', type: 'button', label: 'Button 1', x: 0, y: -40, rot: 0, params: {} });
    p.wires.push(
      { id: '1', a: { part: 'b', term: '1a' }, b: { part: 'esp32', term: 'GPIO18' }, color: '#ff0' },
      { id: '2', a: { part: 'b', term: '1b' }, b: { part: 'esp32', term: 'GND_L' }, color: '#000' },
    );
    p.program.pins = { 18: 'INPUT_PULLUP' };
    const e = run(p, 5);
    expect(e.snapshot().pins.GPIO18.read).toBe(0);
  });
});
