// Editable example projects. They are ordinary projects: same parts, same wires, same simulation rules as a blank one.
import { blankProject, uid, type Project } from '../sim/project';
import type { Action, ActionBody, Rule } from '../sim/program/types';
import type { PartInstance, Wire } from '../sim/types';

const B = 'esp32';
let n = 0;
const w = (a: [string, string], b: [string, string], color: string): Wire => ({ id: `w${++n}`, a: { part: a[0], term: a[1] }, b: { part: b[0], term: b[1] }, color });
export const act = (a: ActionBody, id = uid('a')): Action => ({ ...a, id });
export const rule = (r: Omit<Rule, 'id' | 'enabled' | 'conditions' | 'elseActions'> & Partial<Rule>): Rule =>
  ({ id: uid('r'), enabled: true, conditions: [], elseActions: [], ...r });

export const WIRE_COLORS = {
  power: '#e2483d', ground: '#2b2724', signal: '#f2b632', data: '#3f8ee8', sda: '#3f8ee8', scl: '#43c25c', other: '#a35fd6',
};

export interface Template {
  id: string;
  name: string;
  summary: string;
  parts: string[];
  build(): Project;
  /** Runs a real Arduino sketch (code mode) rather than behaviour rules. */
  code?: boolean;
}

const part = (id: string, type: string, label: string, x: number, y: number, rot: number, params: Record<string, unknown> = {}): PartInstance =>
  ({ id, type, label, x, y, rot, params });

export function weatherStation(): Project {
  const p = blankProject('Home weather station');
  p.origin = 'weather-station';
  p.description = 'A DHT22 measures the air every 2 seconds and the OLED shows the temperature and humidity. Change the air in the DHT22 inspector and watch the display follow.';
  p.parts = [
    part('dht1', 'dht22', 'DHT22 1', 8, -44, 1, { temperature: 22.5, humidity: 48 }),
    part('oled1', 'ssd1306', 'OLED 1', -22, -46, 3, { address: 0x3c, tint: 'white' }),
  ];
  p.wires = [
    w(['dht1', 'VCC'], [B, '3V3'], WIRE_COLORS.power),
    w(['dht1', 'DATA'], [B, 'GPIO4'], WIRE_COLORS.data),
    w(['dht1', 'GND'], [B, 'GND_R'], WIRE_COLORS.ground),
    w(['oled1', 'VCC'], [B, '3V3'], WIRE_COLORS.power),
    w(['oled1', 'GND'], [B, 'GND_R'], WIRE_COLORS.ground),
    w(['oled1', 'SCL'], [B, 'GPIO22'], WIRE_COLORS.scl),
    w(['oled1', 'SDA'], [B, 'GPIO21'], WIRE_COLORS.signal),
  ];
  p.program = {
    pins: {},
    i2c: { sda: 21, scl: 22 },
    devices: [
      { id: 'dht', kind: 'dht', part: 'dht1', model: 'DHT22', pin: 4 },
      { id: 'oled', kind: 'ssd1306', part: 'oled1', address: 0x3c },
    ],
    vars: [{ name: 'temp', initial: 0 }, { name: 'hum', initial: 0 }],
    rules: [
      rule({ name: 'Splash screen', trigger: { kind: 'start' }, actions: [
        act({ kind: 'oledClear', device: 'oled' }),
        act({ kind: 'oledText', device: 'oled', x: 0, y: 0, size: 1, text: 'WEATHER STATION' }),
        act({ kind: 'oledText', device: 'oled', x: 0, y: 24, size: 1, text: 'Reading sensor...' }),
        act({ kind: 'serialPrint', text: 'Weather station starting' }),
      ] }),
      rule({ name: 'Every 2 s: read and show', trigger: { kind: 'every', ms: 2000 }, actions: [
        act({ kind: 'readDht', device: 'dht', temp: 'temp', hum: 'hum' }),
        act({ kind: 'oledClear', device: 'oled' }),
        act({ kind: 'oledText', device: 'oled', x: 0, y: 0, size: 1, text: 'WEATHER STATION' }),
        act({ kind: 'oledText', device: 'oled', x: 0, y: 16, size: 2, text: '{temp:1}°C' }),
        act({ kind: 'oledText', device: 'oled', x: 0, y: 40, size: 2, text: '{hum:0} %RH' }),
        act({ kind: 'serialPrint', text: 'Temperature: {temp:1} C  Humidity: {hum:0} %' }),
      ] }),
    ],
  };
  return p;
}

export function buttonLed(): Project {
  const p = blankProject('Button → LED');
  p.origin = 'button-led';
  p.description = 'Hold the button and the LED lights. The button pulls GPIO4 to GND against the internal pull-up.';
  p.parts = [
    part('btn1', 'button', 'Button 1', 3, -36, 0, { cap: 'red' }),
    part('r1', 'resistor', 'R 1', -20, -34, 0, { ohms: 220 }),
    part('led1', 'led', 'LED 1', -9, -40, 0, { color: 'red' }),
  ];
  p.wires = [
    w(['btn1', '1a'], [B, 'GPIO4'], WIRE_COLORS.signal),
    w(['btn1', '2b'], [B, 'GND_R'], WIRE_COLORS.ground),
    w([B, 'GPIO23'], ['r1', '1'], WIRE_COLORS.data),
    w(['r1', '2'], ['led1', 'A'], WIRE_COLORS.other),
    w(['led1', 'K'], [B, 'GND_R'], WIRE_COLORS.ground),
  ];
  p.program = {
    pins: { 4: 'INPUT_PULLUP', 23: 'OUTPUT' },
    i2c: { sda: 21, scl: 22 },
    devices: [],
    vars: [],
    rules: [
      rule({
        name: 'Button changes → LED follows',
        trigger: { kind: 'pinEdge', pin: 4, edge: 'change' },
        conditions: [{ left: { kind: 'digitalRead', pin: 4 }, op: '==', right: { kind: 'num', value: 0 } }],
        actions: [act({ kind: 'digitalWrite', pin: 23, value: 'HIGH' }), act({ kind: 'serialPrint', text: 'pressed' })],
        elseActions: [act({ kind: 'digitalWrite', pin: 23, value: 'LOW' }), act({ kind: 'serialPrint', text: 'released' })],
      }),
    ],
  };
  return p;
}

export const TEMPLATES: Template[] = [
  { id: 'weather-station', name: 'Home weather station', summary: 'DHT22 readings on an SSD1306 OLED every 2 seconds.', parts: ['DHT22', 'SSD1306 OLED'], build: weatherStation },
  { id: 'button-led', name: 'Button → LED', summary: 'Hold a button to light an LED, using the internal pull-up.', parts: ['Button', 'LED', '220 Ω resistor'], build: buttonLed },
];

// the stage-2 examples live in examples.ts (registered from there to avoid a circular import)
export function registerTemplates(list: Template[]) {
  for (const t of list) if (!TEMPLATES.some((x) => x.id === t.id)) TEMPLATES.push(t);
}
