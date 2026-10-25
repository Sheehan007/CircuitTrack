import { describe, expect, it } from 'vitest';
import { out, runSketch, sketchProject } from './fwhelpers';

const BLINK = `
const int LED_PIN = 23;

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  Serial.println("LED on");
  delay(1000);
  digitalWrite(LED_PIN, LOW);
  Serial.println("LED off");
  delay(1000);
}
`;

const circuit = (opts: { ohms?: number; reversed?: boolean; noGround?: boolean; pin?: string } = {}) => sketchProject(BLINK,
  { r1: { type: 'resistor', params: { ohms: opts.ohms ?? 220 } }, led1: 'led' },
  [
    [`esp32.${opts.pin ?? 'GPIO23'}`, 'r1.1'],
    ['r1.2', opts.reversed ? 'led1.K' : 'led1.A'],
    ...(opts.noGround ? [] : [[opts.reversed ? 'led1.A' : 'led1.K', 'esp32.GND_R'] as [string, string]]),
  ]);

describe('Blink sketch on GPIO23 → 220 Ω → LED → GND', () => {
  it('drives GPIO23 to 3.3 V and lights the LED with I = (V_GPIO − V_LED) / R', () => {
    const e = runSketch(circuit());
    e.advance(1);
    const s = e.snapshot();
    expect(s.firmware).toBe('running');
    expect(s.pins.GPIO23.mode).toBe('OUTPUT');
    expect(s.pins.GPIO23.level).toBe(1);
    expect(s.pins.GPIO23.volts).toBeGreaterThan(3.1);
    const vGpio = s.pins.GPIO23.volts;
    const mid = s.nets[e.netlist.netOf.get('led1:A')!];
    expect(mid.state).toBe('driven');
    const ma = s.parts.led1.visual.ma as number;
    expect(ma).toBeCloseTo(((vGpio - mid.volts!) / 220) * 1000, 1);
    expect(ma).toBeGreaterThan(4);
    expect(s.parts.led1.visual.brightness as number).toBeGreaterThan(0.3);
  });

  it('keeps the nets on either side of the resistor separate', () => {
    const e = runSketch(circuit());
    e.advance(1);
    const s = e.snapshot();
    const gpioNet = s.pins.GPIO23.net;
    expect(s.nets[gpioNet].state).toBe('gpio-high');
    expect(e.netlist.netOf.get('r1:1')).toBe(gpioNet);
    const anode = s.nets[e.netlist.netOf.get('r1:2')!];
    expect(anode.index).toBe(e.netlist.netOf.get('led1:A'));
    expect(anode.index).not.toBe(gpioNet);
    expect(anode.state).toBe('driven');
    expect(s.nets[e.netlist.netOf.get('led1:K')!].state).toBe('ground');
    expect(anode.volts!).toBeLessThan(s.pins.GPIO23.volts - 0.5);
    expect(anode.volts!).toBeGreaterThan(1.6);
  });

  it('blinks every second: transitions in the signal history at 0, 1000, 2000 … ms', () => {
    const e = runSketch(circuit());
    e.advance(5500);
    const h = e.history.get(23)!;
    const ts = h.map((p) => Math.round(p.t));
    expect(ts.slice(0, 6)).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
    expect(h.slice(0, 6).map((p) => p.v)).toEqual([1, 0, 1, 0, 1, 0]);
    expect(out(e).slice(0, 4)).toEqual(['LED on', 'LED off', 'LED on', 'LED off']);
    // at t = 5.5 s the LED is off (5000 ms: LOW)
    expect(e.snapshot().parts.led1.visual.brightness).toBe(0);
    e.advance(600);
    expect(e.snapshot().parts.led1.visual.brightness as number).toBeGreaterThan(0.3);
  });

  it('reversed LED: no current, and the check says so', () => {
    const e = runSketch(circuit({ reversed: true }));
    e.advance(1);
    const s = e.snapshot();
    expect(Math.abs(s.parts.led1.visual.ma as number)).toBeLessThan(0.01);
    expect(s.issues.map((i) => i.code)).toContain('led-reversed');
  });

  it('open circuit (no ground): no current, the cathode net is floating', () => {
    const e = runSketch(circuit({ noGround: true }));
    e.advance(1);
    const s = e.snapshot();
    expect(Math.abs(s.parts.led1.visual.ma as number)).toBeLessThan(0.01);
    expect(s.parts.led1.visual.brightness).toBe(0);
    expect(s.nets[e.netlist.netOf.get('led1:K')!].state).toBe('floating');
  });

  it('a 10 Ω resistor lets too much current through and the check warns', () => {
    const e = runSketch(circuit({ ohms: 10 }));
    e.advance(1);
    const s = e.snapshot();
    expect(s.parts.led1.visual.ma as number).toBeGreaterThan(15);
    expect(s.issues.map((i) => i.code)).toContain('gpio-current-high');
  });
});
