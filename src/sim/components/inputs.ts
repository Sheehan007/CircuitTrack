// More inputs (and the RGB LED): potentiometer, light-dependent resistor, PIR motion sensor.
import type { ComponentDef } from './types';
import type { Element } from '../solver';

export const potentiometer: ComponentDef = {
  type: 'pot',
  name: 'Potentiometer (10 kΩ knob)',
  category: 'Inputs',
  summary: 'A resistor with a slider: wire the outer legs to 3V3 and GND, and the middle leg gives 0–3.3 V for analogRead.',
  status: 'ready',
  insertable: true,
  labelPrefix: 'Knob',
  device: 'pot',
  bounds: [[-6.5, -5.5, 0], [6.5, 6.5, 20]],
  terminals: [
    { id: 'A', label: 'Leg 1', pos: [-5.08, 3.5, 0.4], kind: 'passive', description: 'One end of the track (e.g. GND).' },
    { id: 'W', label: 'Wiper (middle)', pos: [0, 3.5, 0.4], kind: 'signal', description: 'The slider: to an ADC pin (ADC1: GPIO32–39 also works with Wi-Fi on).' },
    { id: 'B', label: 'Leg 3', pos: [5.08, 3.5, 0.4], kind: 'passive', description: 'Other end of the track (e.g. 3V3).' },
  ],
  params: [
    { key: 'position', label: 'Knob position', kind: 'number', group: 'environment', min: 0, max: 100, step: 1, unit: '%', help: '0 % = fully anticlockwise (wiper at leg 1).' },
    { key: 'ohms', label: 'Track', kind: 'select', group: 'config', options: [{ value: 10000, label: '10 kΩ' }, { value: 100000, label: '100 kΩ' }, { value: 1000, label: '1 kΩ' }] },
  ],
  defaults: { ohms: 10000, position: 50 },
  electrical: (c) => {
    const pos = Math.max(0, Math.min(1, Number(c.params.position ?? 50) / 100));
    const R = Number(c.params.ohms) || 10000;
    return [
      { kind: 'R', id: c.id('aw'), a: c.node('A'), b: c.node('W'), ohms: Math.max(1, R * pos) },
      { kind: 'R', id: c.id('wb'), a: c.node('W'), b: c.node('B'), ohms: Math.max(1, R * (1 - pos)) },
    ];
  },
  specs: (p) => [['Track', `${Number(p.ohms) / 1000} kΩ, linear`], ['Rotation', '~300°']],
  alt: () => 'Rotary potentiometer with a ridged knob and three legs in a row.',
};

/** GL5528-style LDR: ~10–20 kΩ at 10 lux, ~1 MΩ in the dark. R ≈ 15 kΩ × (lux / 10)^−0.7. */
export const ldrOhms = (lux: number) => Math.min(1_000_000, 15_000 * Math.pow(Math.max(0.1, lux) / 10, -0.7));

export const ldr: ComponentDef = {
  type: 'ldr',
  name: 'Light sensor (LDR)',
  category: 'Inputs',
  summary: 'Resistance falls as light rises. Pair it with a 10 kΩ resistor as a divider and read the middle with analogRead.',
  status: 'ready',
  insertable: true,
  labelPrefix: 'LDR',
  device: 'ldr',
  bounds: [[-3, -3, 0], [3, 3, 9]],
  terminals: [
    { id: '1', label: 'Leg 1', pos: [0, 1.27, 0.4], kind: 'passive', description: 'No polarity.' },
    { id: '2', label: 'Leg 2', pos: [0, -1.27, 0.4], kind: 'passive', description: 'No polarity.' },
  ],
  params: [{ key: 'lux', label: 'Light level', kind: 'number', group: 'environment', min: 0, max: 2000, step: 5, unit: 'lux', help: 'Dark room ≈ 1, living room ≈ 50–150, office ≈ 500, overcast daylight ≈ 1000+.' }],
  defaults: { lux: 120 },
  electrical: (c) => [{ kind: 'R', id: c.id('r'), a: c.node('1'), b: c.node('2'), ohms: ldrOhms(Number(c.params.lux ?? 120)) }],
  specs: (p) => [['Type', 'CdS photoresistor (GL5528-like)'], ['Now', `≈ ${(ldrOhms(Number(p.lux)) / 1000).toFixed(1)} kΩ`], ['Dark / bright', '~1 MΩ / ~1 kΩ']],
  alt: () => 'Light-dependent resistor: a small disc with a wavy track on its face and two legs.',
};

export const pir: ComponentDef = {
  type: 'pir',
  name: 'PIR motion sensor (HC-SR501)',
  category: 'Sensors',
  summary: 'OUT goes HIGH (3.3 V) for a few seconds when something warm moves. Needs 4.5–20 V on VCC: use VIN.',
  status: 'ready',
  labelPrefix: 'PIR',
  device: 'pir',
  bounds: [[-16.5, -12.5, 0], [16.5, 12.5, 24]],
  terminals: [
    { id: 'VCC', label: 'VCC', pos: [13, 2.54, 9], kind: 'power', description: '4.5–20 V: VIN (5 V) on the ESP32. 3.3 V is not enough.' },
    { id: 'OUT', label: 'OUT', pos: [13, 0, 9], kind: 'signal', description: '3.3 V logic output: safe straight into a GPIO.' },
    { id: 'GND', label: 'GND', pos: [13, -2.54, 9], kind: 'ground', description: 'Ground.' },
  ],
  params: [
    { key: 'holdMs', label: 'Hold time', kind: 'select', group: 'config', options: [{ value: 3000, label: '3 s (pot fully left)' }, { value: 10000, label: '10 s' }, { value: 30000, label: '30 s' }], help: 'How long OUT stays HIGH after the last movement (the orange Tx pot).' },
  ],
  defaults: { holdMs: 3000 },
  power: { vcc: 'VCC', gnd: 'GND', minV: 4.5, maxV: 20, typicalMa: 0.065 },
  interactions: [{ key: 'motion', label: 'Wave in front', kind: 'momentary', help: 'Hold to keep moving in front of the sensor; OUT stays HIGH for the hold time after you stop.' }],
  electrical: (c) => {
    const els: Element[] = [{ kind: 'R', id: c.id('load'), a: c.node('VCC'), b: c.node('GND'), ohms: 75_000 }];
    const vcc = c.volts('VCC'), gnd = c.volts('GND');
    const powered = vcc != null && gnd != null && vcc - gnd >= 4.5;
    // the output is actively driven (3.3 V from its own regulator) only while the sensor is powered
    if (powered) els.push({ kind: 'V', id: c.id('out'), p: c.node('OUT'), n: c.node('GND'), volts: c.state?.out ? 3.3 : 0, ohms: 100 });
    return els;
  },
  specs: () => [['Supply', '4.5–20 V, ~65 µA'], ['Output', '3.3 V HIGH while triggered'], ['Range', 'up to ~7 m, 120° cone'], ['Warm-up', '~1 min on real modules (not simulated)']],
  alt: () => 'HC-SR501 PIR motion sensor: a white faceted plastic dome on a green board with three pins.',
};

export const RGB_VF = { r: 2.0, g: 3.0, b: 3.0 };
export const rgbLed: ComponentDef = {
  type: 'rgb',
  name: 'RGB LED (common cathode)',
  category: 'Outputs',
  summary: 'Three LEDs in one lens sharing the longest leg (cathode → GND). Give each colour its own resistor and PWM pin.',
  status: 'ready',
  insertable: true,
  labelPrefix: 'RGB',
  device: 'rgb',
  bounds: [[-5, -3, 0], [5, 3, 14]],
  terminals: [
    { id: 'R', label: 'Red', pos: [-3.81, 0, 0.4], kind: 'passive', description: 'Red anode: GPIO through ~220 Ω.' },
    { id: 'K', label: 'Cathode (−, longest)', pos: [-1.27, 0, 0.4], kind: 'passive', description: 'Common cathode: to GND.' },
    { id: 'G', label: 'Green', pos: [1.27, 0, 0.4], kind: 'passive', description: 'Green anode: GPIO through ~220 Ω.' },
    { id: 'B', label: 'Blue', pos: [3.81, 0, 0.4], kind: 'passive', description: 'Blue anode: GPIO through ~220 Ω.' },
  ],
  params: [],
  defaults: {},
  electrical: (c) => (['R', 'G', 'B'] as const).map((k): Element => ({ kind: 'D', id: c.id(k.toLowerCase()), a: c.node(k), b: c.node('K'), vf: RGB_VF[k.toLowerCase() as 'r'], rs: 12 })),
  specs: () => [['Type', 'common cathode, diffused 5 mm'], ['Forward voltage', 'R 2.0 V, G 3.0 V, B 3.0 V'], ['Current', 'up to 20 mA per colour']],
  alt: () => 'Diffused 5 mm RGB LED with four legs; the second one, the longest, is the common cathode.',
};
