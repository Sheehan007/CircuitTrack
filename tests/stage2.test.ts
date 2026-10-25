import { describe, expect, it } from 'vitest';
import { EXAMPLES, cryptoTicker, lyricDisplay, motionAlarm, moodLight, motorController, nightLight, servoGate, tempFan, weatherTft } from '../src/content/examples';
import { Engine } from '../src/sim/engine';
import { SPRITE_NAMES, builtinSprite } from '../src/sim/devices/sprites';
import { ColorFramebuffer } from '../src/sim/devices/colorFramebuffer';
import { generateSketch } from '../src/sim/program/codegen';
import { getFeed } from '../src/sim/feeds';
import type { Project } from '../src/sim/project';
import { codes, has, rewire, run, serialText } from './helpers';

const setParam = (e: Engine, p: Project, id: string, key: string, value: unknown) => {
  const q: Project = JSON.parse(JSON.stringify(p));
  q.parts.find((x) => x.id === id)!.params[key] = value;
  e.setProject(q);
  return q;
};
const vis = (e: Engine, id: string) => e.snapshot().parts[id].visual as Record<string, any>;

describe('every example project', () => {
  for (const ex of EXAMPLES) {
    it(`${ex.name}: no errors as shipped, runs for 5 s`, () => {
      const e = new Engine(ex.build(), { seed: 3 });
      expect(e.snapshot().issues.filter((i) => i.severity === 'error')).toEqual([]);
      e.start();
      e.advance(5000);
      const s = e.snapshot();
      expect(s.firmware).toBe('running');
      expect(s.issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(generateSketch(ex.build().program).length).toBeGreaterThan(200);
    });
  }
});

describe('sprites and colour framebuffer', () => {
  it('built-in sprites are 16 × 16', () => {
    for (const n of SPRITE_NAMES) {
      const s = builtinSprite(n)!;
      expect(s.px).toHaveLength(256);
    }
  });
  it('draws text and shapes in 16-bit colour', () => {
    const fb = new ColorFramebuffer(128, 160);
    fb.fillRect(0, 0, 10, 10, '#ff0000');
    fb.commit();
    expect(fb.at(5, 5)).toBe('#ff0000');
    fb.fillRect(0, 0, 1, 1, '#123456');
    fb.commit();
    expect(fb.at(0, 0)).not.toBe('#123456'); // quantised to RGB565
  });
});

describe('TFT + BME280 weather station', () => {
  it('shows orange temperature text and bars', () => {
    const e = run(weatherTft(), 100);
    const fb = e.framebuffers.get('tft1')! as unknown as ColorFramebuffer;
    let orange = 0;
    for (let y = 30; y < 50; y++) for (let x = 24; x < 120; x++) if (fb.at(x, y) !== '#000000') orange++;
    expect(orange).toBeGreaterThan(50);
    expect(serialText(e)).toMatch(/(20\.9|21\.\d) C, 4[45] %, 101[23]\.\d hPa/);
  });
  it('a BME280 on VIN is over its 3.6 V rating', () => {
    const p = rewire(weatherTft(), { part: 'bme1', term: 'VCC' }, { part: 'esp32', term: 'VIN' });
    expect(codes(new Engine(p))).toContain('device-overvoltage');
  });
  it('SCK on the wrong pin keeps the screen black and says why', () => {
    const p = rewire(weatherTft(), { part: 'tft1', term: 'SCK' }, { part: 'esp32', term: 'GPIO19' });
    const e = run(p, 100);
    expect(has(e, 'spi-not-wired')).toBe(true);
  });
});

describe('servo', () => {
  it('moves the horn to 90° within a fraction of a second after the button', () => {
    const e = run(servoGate(), 400);
    expect(Math.round(vis(e, 'sv1').angle)).toBe(0);
    e.interact('btn1', 'pressed', true);
    e.advance(50);
    expect(vis(e, 'sv1').moving).toBe(true);
    e.advance(300);
    expect(Math.round(vis(e, 'sv1').angle)).toBe(90);
    expect(e.snapshot().pins.GPIO19.fn).toBe('Servo');
  });
  it('powered from 3V3 it is under-voltage and does not move', () => {
    const p = rewire(servoGate(), { part: 'sv1', term: 'VCC' }, { part: 'esp32', term: '3V3' });
    expect(codes(new Engine(p))).toContain('device-undervoltage');
    const e = run(p, 100);
    e.interact('btn1', 'pressed', true);
    e.advance(500);
    expect(Math.round(vis(e, 'sv1').angle)).toBe(90); // still at its rest position: it never moved
    expect(vis(e, 'sv1').moving).toBe(false);
  });
});

describe('DC motor through the L298N', () => {
  it('spins at a speed set by the knob and reverses on the button', () => {
    const p = motorController();
    const e = run(p, 1000);
    const rpm = vis(e, 'm1').rpm;
    expect(rpm).toBeGreaterThan(20);
    setParam(e, p, 'pot1', 'position', 100);
    e.advance(1000);
    expect(vis(e, 'm1').rpm).toBeGreaterThan(rpm);
    e.interact('btn1', 'pressed', true);
    e.advance(1000);
    expect(vis(e, 'm1').rpm).toBeLessThan(-20);
  });
  it('without a shared ground the driver ignores the ESP32', () => {
    const p = motorController();
    p.wires = p.wires.filter((w) => !(w.a.part === 'drv1' && w.a.term === 'GND' && w.b.part === 'esp32'));
    expect(codes(new Engine(p))).toContain('driver-no-common-ground');
    const e = run(p, 1000);
    expect(Math.abs(vis(e, 'm1').rpm)).toBeLessThan(1);
  });
  it('a motor wired straight to a GPIO is an error and overloads the pin', () => {
    const p = motorController();
    p.wires = p.wires.filter((w) => w.a.part !== 'm1' && w.b.part !== 'm1');
    p.wires.push({ id: 'g1', a: { part: 'm1', term: 'M1' }, b: { part: 'esp32', term: 'GPIO19' }, color: '#f00' }, { id: 'g2', a: { part: 'm1', term: 'M2' }, b: { part: 'esp32', term: 'GND_L' }, color: '#000' });
    p.program.pins[19] = 'OUTPUT';
    p.program.rules.push({ id: 'r', name: 'on', enabled: true, trigger: { kind: 'start' }, conditions: [], actions: [{ id: 'a', kind: 'digitalWrite', pin: 19, value: 'HIGH' }], elseActions: [] });
    const e = run(p, 100);
    expect(has(e, 'gpio-drives-motor')).toBe(true);
    expect(e.snapshot().pins.GPIO19.ma).toBeGreaterThan(20);
  });
});

describe('temperature fan and alarm', () => {
  it('fan above 28 °C, buzzer above 35 °C', () => {
    const p = tempFan();
    const e = run(p, 2100);
    expect(Math.abs(vis(e, 'm1').rpm)).toBeLessThan(1);
    expect(vis(e, 'bz1').sounding).toBe(false);
    const q = setParam(e, p, 'dht1', 'temperature', 30);
    e.advance(3000);
    expect(vis(e, 'm1').rpm).toBeGreaterThan(20);
    expect(vis(e, 'bz1').sounding).toBe(false);
    setParam(e, q, 'dht1', 'temperature', 37);
    e.advance(2100);
    expect(vis(e, 'bz1').sounding).toBe(true);
  });
});

describe('inputs', () => {
  it('night light: darker room → brighter LED', () => {
    const p = nightLight();
    const e = run(p, 300);
    const bright = vis(e, 'led1').brightness;
    setParam(e, p, 'ldr1', 'lux', 2);
    e.advance(300);
    expect(vis(e, 'led1').brightness).toBeGreaterThan(bright + 0.2);
  });
  it('PIR: motion raises GPIO18, the alarm follows and stops after the hold time', () => {
    const e = run(motionAlarm(), 100);
    expect(vis(e, 'bz1').sounding).toBe(false);
    e.interact('pir1', 'motion', true);
    e.advance(20);
    expect(e.snapshot().pins.GPIO18.read).toBe(1);
    expect(vis(e, 'bz1').sounding).toBe(true);
    e.interact('pir1', 'motion', false);
    e.advance(3200);
    expect(vis(e, 'bz1').sounding).toBe(false);
  });
  it('PIR on 3V3 never triggers', () => {
    const p = rewire(motionAlarm(), { part: 'pir1', term: 'VCC' }, { part: 'esp32', term: '3V3' });
    expect(codes(new Engine(p))).toContain('device-undervoltage');
    const e = run(p, 100);
    e.interact('pir1', 'motion', true);
    e.advance(100);
    expect(vis(e, 'bz1').sounding).toBe(false);
  });
  it('RGB: three PWM pins give three different channel levels', () => {
    const e = run(moodLight(), 50);
    const { r, g, b } = vis(e, 'rgb1');
    expect(new Set([r, g, b].map((x: number) => x.toFixed(2))).size).toBeGreaterThan(1);
  });
});

describe('displays with data', () => {
  it('lyrics: steps lines, plays a note per line, pauses on the button', () => {
    const e = run(lyricDisplay(), 100);
    expect(serialText(e)).toContain('Wires hum soft tunes');
    expect(vis(e, 'pz1').sounding).toBe(true);
    expect(vis(e, 'pz1').hz).toBe(392);
    e.advance(1500);
    expect(serialText(e)).toContain('Electrons in rows');
    e.interact('btn1', 'pressed', true);
    e.advance(3100);
    expect(serialText(e)).not.toContain('The board still glows');
  });
  it('crypto: simulated, deterministic prices', () => {
    expect(getFeed('btc').simulated).toBe(true);
    const a = run(cryptoTicker(), 3000), b = run(cryptoTicker(), 3000);
    expect(serialText(a)).toBe(serialText(b));
    expect(serialText(a)).toMatch(/BTC\/USD \d+\.\d\d \(simulated\)/);
    expect(generateSketch(cryptoTicker().program)).toContain('SIMULATED');
  });
});
