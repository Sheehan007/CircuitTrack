import type { ElectricalCtx, ComponentDef } from './types';
import type { Element } from '../solver';

/** A constant-resistance stand-in for a module's supply current at its nominal voltage. */
const load = (c: ElectricalCtx, vcc: string, gnd: string, ma: number, nominal = 3.3): Element =>
  ({ kind: 'R', id: c.id('load'), a: c.node(vcc), b: c.node(gnd), ohms: nominal / (ma / 1000) });

const dhtCommon = (variant: 'DHT22' | 'DHT11'): ComponentDef => {
  const is22 = variant === 'DHT22';
  return {
    type: variant.toLowerCase(),
    name: `${variant} temperature & humidity module`,
    category: 'Sensors',
    summary: is22
      ? 'Digital temperature (−40…80 °C, ±0.5 °C) and humidity (0–100 %RH) on one data wire. Read at most every 2 s.'
      : 'Basic temperature (0…50 °C, ±2 °C) and humidity (20–80 %RH) sensor on one data wire. Read at most once a second.',
    status: 'ready',
    labelPrefix: variant,
    device: 'dht',
    bounds: [[-18, -8.5, 0], [12, 8.5, 11]],
    terminals: [
      { id: 'VCC', label: '+ (VCC)', pos: [9.5, 2.54, 9.2], kind: 'power', description: is22 ? '3.3–6 V. Use 3V3 on an ESP32 so DATA stays at a safe 3.3 V.' : '3.3–5.5 V. Use 3V3 on an ESP32.' },
      { id: 'DATA', label: 'OUT (DATA)', pos: [9.5, 0, 9.2], kind: 'signal', description: 'Single-wire data. The module has a 10 kΩ pull-up to VCC.' },
      { id: 'GND', label: '− (GND)', pos: [9.5, -2.54, 9.2], kind: 'ground', description: 'Ground.' },
    ],
    params: [
      { key: 'temperature', label: 'Air temperature', kind: 'number', group: 'environment', min: -40, max: 80, step: 0.5, unit: '°C', help: 'The temperature around the sensor.' },
      { key: 'humidity', label: 'Relative humidity', kind: 'number', group: 'environment', min: 0, max: 100, step: 1, unit: '%RH' },
    ],
    defaults: { temperature: 22.5, humidity: 48 },
    power: { vcc: 'VCC', gnd: 'GND', minV: 3.0, maxV: is22 ? 6.0 : 5.5, typicalMa: 1.5 },
    electrical: (c) => [
      load(c, 'VCC', 'GND', 1.5),
      { kind: 'R', id: c.id('pullup'), a: c.node('DATA'), b: c.node('VCC'), ohms: 10_000 },
    ],
    specs: () => is22
      ? [['Temperature', '−40…80 °C, ±0.5 °C, 0.1 °C steps'], ['Humidity', '0–100 %RH, ±2–5 %'], ['Sampling', 'once every 2 s'], ['Supply', '3.3–6 V, ~1.5 mA while measuring'], ['Interface', 'single-wire digital']]
      : [['Temperature', '0…50 °C, ±2 °C, 1 °C steps'], ['Humidity', '20–80 %RH, ±5 %'], ['Sampling', 'once a second'], ['Supply', '3.3–5.5 V'], ['Interface', 'single-wire digital']],
    alt: () => `${variant} sensor: a ${is22 ? 'white' : 'blue'} ventilated plastic case on a small module board with three pins: VCC, DATA and GND.`,
  };
};

export const dht22 = dhtCommon('DHT22');
export const dht11 = dhtCommon('DHT11');

export const ssd1306: ComponentDef = {
  type: 'ssd1306',
  name: 'SSD1306 OLED 0.96" (I²C)',
  category: 'Displays',
  summary: '128 × 64 monochrome display on I²C (SDA/SCL). Address 0x3C on most modules. Has its own 3.3 V regulator.',
  status: 'ready',
  labelPrefix: 'OLED',
  device: 'ssd1306',
  bounds: [[-13.8, -13.6, 0], [13.8, 13.6, 10]],
  terminals: [
    { id: 'GND', label: 'GND', pos: [-11, 3.81, 9.6], kind: 'ground', description: 'Ground.' },
    { id: 'VCC', label: 'VCC', pos: [-11, 1.27, 9.6], kind: 'power', description: '3.3–5 V. The module regulates it down to 3.3 V.' },
    { id: 'SCL', label: 'SCL', pos: [-11, -1.27, 9.6], kind: 'signal', description: 'I²C clock. Default on the ESP32: GPIO22.' },
    { id: 'SDA', label: 'SDA', pos: [-11, -3.81, 9.6], kind: 'signal', description: 'I²C data. Default on the ESP32: GPIO21.' },
  ],
  params: [
    { key: 'address', label: 'I²C address', kind: 'select', group: 'config', options: [{ value: 0x3c, label: '0x3C (default)' }, { value: 0x3d, label: '0x3D (address jumper moved)' }], help: 'Two devices on one bus must not share an address.' },
    { key: 'tint', label: 'Pixel colour', kind: 'select', group: 'config', options: [{ value: 'white', label: 'White' }, { value: 'blue', label: 'Blue' }, { value: 'yellow-blue', label: 'Yellow top rows, blue below' }] },
  ],
  defaults: { address: 0x3c, tint: 'white' },
  power: { vcc: 'VCC', gnd: 'GND', minV: 3.0, maxV: 5.5, typicalMa: 20 },
  electrical: (c) => {
    // On-board LDO: during the first pass the rail just follows VCC; once VCC is known to be high enough the rail
    // is a regulated 3.3 V, so the I²C pull-ups never reach 5 V even when the module runs from VIN.
    const rail = c.internal('rail');
    const els: Element[] = [load(c, 'VCC', 'GND', 20)];
    if (c.supply != null && c.supply >= 3.5) els.push({ kind: 'V', id: c.id('ldo'), p: rail, n: c.node('GND'), volts: 3.3, ohms: 1 });
    else els.push({ kind: 'R', id: c.id('ldo'), a: c.node('VCC'), b: rail, ohms: 1 });
    els.push({ kind: 'R', id: c.id('pu_sda'), a: c.node('SDA'), b: rail, ohms: 4700 });
    els.push({ kind: 'R', id: c.id('pu_scl'), a: c.node('SCL'), b: rail, ohms: 4700 });
    return els;
  },
  specs: (p) => [['Resolution', '128 × 64 px, 1 bit'], ['Controller', 'SSD1306'], ['Interface', `I²C at 0x${Number(p.address).toString(16).toUpperCase()}`], ['Supply', '3.3–5 V, ~20 mA'], ['Pull-ups', '4.7 kΩ on SDA/SCL to the regulated 3.3 V rail']],
  alt: (p) => `0.96 inch OLED display module, ${p.tint} pixels, with four pins: GND, VCC, SCL and SDA.`,
};
