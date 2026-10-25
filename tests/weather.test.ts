import { describe, expect, it } from 'vitest';
import { weatherStation } from '../src/content/templates';
import { Engine } from '../src/sim/engine';
import { renderText } from '../src/sim/devices/framebuffer';
import { GLYPH_COUNT } from '../src/sim/devices/font5x7';
import { generateSketch } from '../src/sim/program/codegen';
import { codes, has, rewire, run, serialText } from './helpers';

const fb = (e: Engine) => e.framebuffers.get('oled1')!;

/** Does the shown OLED image contain `text` drawn at (x, y) with this size? */
function shows(e: Engine, text: string, x: number, y: number, size: number) {
  const ref = renderText(text, size);
  const img = fb(e);
  for (let j = 0; j < ref.height; j++) for (let i = 0; i < ref.width; i++) {
    const want = ref.shown[j * ref.width + i];
    const X = x + i, Y = y + j;
    if (X >= 128 || Y >= 64) continue;
    if (img.shown[Y * 128 + X] !== want) return false;
  }
  return true;
}

describe('font', () => {
  it('covers printable ASCII and the degree sign', () => {
    expect(GLYPH_COUNT).toBe(96);
    expect(renderText('A').litCount()).toBeGreaterThan(10);
  });
});

describe('weather station template', () => {
  it('has no errors as shipped', () => {
    const e = new Engine(weatherStation());
    expect(e.snapshot().issues.filter((i) => i.severity !== 'info')).toEqual([]);
  });

  it('shows a splash, then readings every 2 s on the OLED and serial', () => {
    const e = run(weatherStation(), 10);
    expect(shows(e, 'WEATHER STATION', 0, 0, 1)).toBe(true);
    expect(shows(e, 'Reading sensor...', 0, 24, 1)).toBe(true);
    e.advance(2000);
    // the DHT22 model adds ±0.1 °C of jitter, like the real sensor
    expect(['22.4°C', '22.5°C', '22.6°C'].some((t) => shows(e, t, 0, 16, 2))).toBe(true);
    expect(shows(e, '48 %RH', 0, 40, 2)).toBe(true);
    expect(serialText(e)).toMatch(/Temperature: 22\.\d C {2}Humidity: 4[78] %/);
  });

  it('follows a change in the air around the sensor', () => {
    const p = weatherStation();
    const e = run(p, 2010);
    const hot = JSON.parse(JSON.stringify(p));
    hot.parts.find((x: { id: string }) => x.id === 'dht1').params.temperature = 31;
    e.setProject(hot);
    e.advance(2000);
    expect(shows(e, '31.0°C', 0, 16, 2) || shows(e, '30.9°C', 0, 16, 2) || shows(e, '31.1°C', 0, 16, 2)).toBe(true);
  });

  it('a DATA wire on the wrong pin makes reads fail with an explanation', () => {
    const p = rewire(weatherStation(), { part: 'dht1', term: 'DATA' }, { part: 'esp32', term: 'GPIO5' });
    expect(codes(new Engine(p))).toContain('dht-wrong-pin');
    const e = run(p, 2010);
    expect(serialText(e)).toContain('Failed to read from DHT sensor!');
    expect(shows(e, 'nan°C', 0, 16, 2)).toBe(true);
  });

  it('a missing ground leaves the DHT unpowered', () => {
    const p = weatherStation();
    p.wires = p.wires.filter((w) => !(w.a.part === 'dht1' && w.a.term === 'GND'));
    const e = run(p, 2010);
    expect(has(e, 'missing-ground')).toBe(true);
    expect(has(e, 'device-unpowered')).toBe(true);
  });

  it('swapped SDA/SCL keeps the display dark and says why', () => {
    let p = rewire(weatherStation(), { part: 'oled1', term: 'SDA' }, { part: 'esp32', term: 'GPIO22' });
    p = rewire(p, { part: 'oled1', term: 'SCL' }, { part: 'esp32', term: 'GPIO21' });
    const e = run(p, 2010);
    expect(fb(e).litCount()).toBe(0);
    expect(has(e, 'i2c-swapped')).toBe(true);
  });

  it('two OLEDs at the same address conflict', () => {
    const p = weatherStation();
    p.parts.push({ id: 'oled2', type: 'ssd1306', label: 'OLED 2', x: -60, y: -46, rot: 3, params: { address: 0x3c } });
    p.wires.push(
      { id: 'x1', a: { part: 'oled2', term: 'SDA' }, b: { part: 'esp32', term: 'GPIO21' }, color: '#00f' },
      { id: 'x2', a: { part: 'oled2', term: 'SCL' }, b: { part: 'esp32', term: 'GPIO22' }, color: '#0f0' },
      { id: 'x3', a: { part: 'oled2', term: 'VCC' }, b: { part: 'esp32', term: '3V3' }, color: '#f00' },
      { id: 'x4', a: { part: 'oled2', term: 'GND' }, b: { part: 'esp32', term: 'GND_L' }, color: '#000' },
    );
    expect(codes(new Engine(p))).toContain('i2c-conflict');
  });

  it('a DHT22 on VIN pulls the data line to 5 V: over-voltage on GPIO4', () => {
    const p = rewire(weatherStation(), { part: 'dht1', term: 'VCC' }, { part: 'esp32', term: 'VIN' });
    const e = run(p, 10);
    expect(e.snapshot().pins.GPIO4.volts).toBeGreaterThan(4);
    expect(has(e, 'gpio-overvoltage')).toBe(true);
  });

  it('an OLED on VIN is fine: its regulator keeps the I²C pull-ups at 3.3 V', () => {
    const p = rewire(weatherStation(), { part: 'oled1', term: 'VCC' }, { part: 'esp32', term: 'VIN' });
    const e = run(p, 10);
    expect(e.snapshot().pins.GPIO21.volts).toBeLessThan(3.4);
    expect(has(e, 'gpio-overvoltage')).toBe(false);
    expect(fb(e).litCount()).toBeGreaterThan(0);
  });

  it('generates an equivalent sketch', () => {
    const code = generateSketch(weatherStation().program, 'Weather');
    expect(code).toContain('DHT dht(4, DHT22);');
    expect(code).toContain('Wire.begin(21, 22);');
    expect(code).toContain('oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);');
    expect(code).toContain('if (now - last_');
    expect(code).toContain('oled.write(247);');
  });
});
