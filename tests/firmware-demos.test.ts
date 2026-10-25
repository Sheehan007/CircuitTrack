import { describe, expect, it } from 'vitest';
import { CODE_DEMOS, SKETCH_EXAMPLES, blinkDemo, buttonDemo, dimmerDemo, melodyDemo, servoDemo, weatherDemo } from '../src/content/sketches';
import { compileSketch } from '../src/sim/firmware/compiler';
import type { Project } from '../src/sim/project';
import { out, runSketch } from './fwhelpers';

const errors = (e: ReturnType<typeof runSketch>) => e.snapshot().issues.filter((i) => i.severity === 'error').map((i) => `${i.code}: ${i.title}`);
const withParam = (p: Project, id: string, params: Record<string, unknown>): Project =>
  ({ ...p, parts: p.parts.map((x) => (x.id === id ? { ...x, params: { ...x.params, ...params } } : x)) });

describe('every example sketch compiles without errors', () => {
  for (const s of SKETCH_EXAMPLES) {
    it(s.name, () => {
      const r = compileSketch(s.source);
      expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(r.ok).toBe(true);
    });
  }
});

describe('code demos run end to end', () => {
  it('all demos: no errors as shipped, 5 s of running', () => {
    for (const d of CODE_DEMOS) {
      const e = runSketch(d.build());
      e.advance(5000);
      expect(e.snapshot().firmware, d.name).toBe('running');
      expect(errors(e), d.name).toEqual([]);
    }
  });

  it('1. Blink: GPIO23 toggles every 1000 ms and the LED follows', () => {
    const e = runSketch(blinkDemo());
    e.advance(10);
    expect(e.snapshot().parts.led1.visual.brightness as number).toBeGreaterThan(0.3);
    e.advance(1000);
    expect(e.snapshot().parts.led1.visual.brightness).toBe(0);
    e.advance(3000);
    expect(e.history.get(23)!.map((h) => Math.round(h.t))).toEqual([0, 1000, 2000, 3000, 4000]);
  });

  it('2. Button → LED: the LED is on only while the button is held', () => {
    const e = runSketch(buttonDemo());
    e.advance(50);
    expect(e.snapshot().pins.GPIO4.volts).toBeGreaterThan(3);
    expect(e.snapshot().parts.led1.visual.brightness).toBe(0);
    e.interact('btn1', 'pressed', true);
    e.advance(30);
    expect(e.snapshot().pins.GPIO23.level).toBe(1);
    expect(e.snapshot().parts.led1.visual.brightness as number).toBeGreaterThan(0.3);
    e.interact('btn1', 'pressed', false);
    e.advance(30);
    expect(e.snapshot().parts.led1.visual.brightness).toBe(0);
    expect(out(e)).toEqual(['pressed', 'released']);
  });

  it('3. PWM dimmer: brightness follows the knob', () => {
    const at = (position: number) => {
      const e = runSketch(withParam(dimmerDemo(), 'pot1', { position }));
      e.advance(500);
      const s = e.snapshot();
      return { b: s.parts.led1.visual.brightness as number, pwm: s.pins.GPIO23.pwm, fn: s.pins.GPIO23.fn };
    };
    const low = at(10), mid = at(50), high = at(90);
    expect(low.b).toBeLessThan(mid.b);
    expect(mid.b).toBeLessThan(high.b);
    expect(mid.pwm).toBeGreaterThan(110);
    expect(mid.pwm).toBeLessThan(145);
    expect(mid.fn).toBe('PWM 5 kHz');
  });

  it('4. Buzzer melody: the buzzer sounds the notes of the tune, then rests', () => {
    const e = runSketch(melodyDemo());
    const heard: number[] = [];
    for (let t = 0; t < 5000; t += 50) {
      e.advance(50);
      const v = e.snapshot().parts.pz1.visual;
      if (v.sounding && heard[heard.length - 1] !== v.hz) heard.push(v.hz as number);
    }
    expect(heard.slice(0, 7)).toEqual([262, 392, 440, 392, 349, 330, 294]);
    e.advance(400);
    expect(e.snapshot().parts.pz1.visual.sounding).toBe(false);
  });

  it('5. Servo: the arm turns to the knob angle', () => {
    let p = servoDemo();
    const e = runSketch(p);
    e.advance(1500);
    const a1 = e.snapshot().parts.sv1.visual.angle as number;
    expect(a1).toBeGreaterThan(40);
    expect(a1).toBeLessThan(50);
    p = withParam(p, 'pot1', { position: 75 });
    e.setProject(p);
    e.advance(1500);
    const a2 = e.snapshot().parts.sv1.visual.angle as number;
    expect(a2).toBeGreaterThan(130);
    expect(a2).toBeLessThan(140);
    expect(out(e).some((l) => /^angle 13\d$/.test(l))).toBe(true);
  });

  it('6. Weather station: BME280 readings on the OLED and in Serial', () => {
    const e = runSketch(weatherDemo());
    e.advance(100);
    const fb = e.framebuffers.get('oled1')!;
    expect(fb.litCount()).toBeGreaterThan(200);
    expect(out(e)[0]).toMatch(/^2\d\.\d C {2}4\d %  10\d\d\.\d hPa$/);
    // disconnecting the OLED's SDA blanks nothing already shown, but new frames don't arrive and the check explains why
    const cut = { ...weatherDemo(), wires: weatherDemo().wires.filter((x) => !(x.a.part === 'oled1' && x.a.term === 'SDA')) };
    const e2 = runSketch(cut);
    e2.advance(100);
    expect(e2.framebuffers.get('oled1')!.litCount()).toBe(0);
    expect(e2.snapshot().issues.map((i) => i.code)).toContain('i2c-not-wired');
  });

  it('6b. Weather station without the BME280 wired: the sketch reports it, like on real hardware', () => {
    const p = weatherDemo();
    const cut = { ...p, wires: p.wires.filter((x) => !(x.a.part === 'bme1' && x.a.term === 'VCC')) };
    const e = runSketch(cut);
    e.advance(100);
    expect(out(e)).toContain('Could not find a valid BME280 sensor, check wiring!');
    expect(e.snapshot().issues.map((i) => i.code)).toContain('device-unpowered');
    expect(e.framebuffers.get('oled1')!.litCount()).toBeGreaterThan(20); // "BME280 not found"
  });
});

describe('behaviour projects converted to code (the Code tab offers this)', () => {
  it('every template and lesson: the generated sketch compiles and runs 3 s without crashing', async () => {
    const { TEMPLATES } = await import('../src/content/templates');
    await import('../src/content/examples');
    const { LESSONS } = await import('../src/content/lessons');
    const { generateSketch } = await import('../src/sim/program/codegen');
    const projects = [...TEMPLATES.filter((t) => !t.code).map((t) => t.build()), ...LESSONS.map((l) => l.build(l.defaults))];
    expect(projects.length).toBeGreaterThan(10);
    for (const p of projects) {
      const code: Project = { ...p, runMode: 'code', firmware: { source: generateSketch(p.program, p.name) } };
      const e = runSketch(code);
      e.advance(3000);
      expect(e.snapshot().firmware, p.name).toBe('running');
    }
  });
});
