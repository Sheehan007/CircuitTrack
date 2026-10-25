// Stage-2 example projects. Like the first two templates, these are ordinary editable projects: same parts, same
// wiring rules, same simulation as anything built from a blank board.
import { blankProject, type Project } from '../sim/project';
import type { Rule, Value } from '../sim/program/types';
import type { PartInstance, Wire } from '../sim/types';
import { act, registerTemplates, rule, WIRE_COLORS as C } from './templates';

const B = 'esp32';
let n = 0;
const part = (id: string, type: string, label: string, x: number, y: number, rot: number, params: Record<string, unknown> = {}): PartInstance => ({ id, type, label, x, y, rot, params });
const w = (a: string, b: string, color: string): Wire => {
  const [ap, at] = a.split('.'), [bp, bt] = b.split('.');
  return { id: `x${++n}`, a: { part: ap, term: at }, b: { part: bp, term: bt }, color };
};
const num = (value: number): Value => ({ kind: 'num', value });
const v = (name: string): Value => ({ kind: 'var', name });
const cmp = (left: Value, op: '==' | '>=' | '<' | '!=', right: Value) => ({ left, op, right });

function base(name: string, origin: string, description: string): Project {
  const p = blankProject(name);
  p.origin = origin;
  p.description = description;
  return p;
}

/* ---------------- weather station on a colour TFT with a BME280 ---------------- */
export function weatherTft(): Project {
  const p = base('Weather station (TFT + BME280)', 'weather-tft', 'A BME280 measures temperature, humidity and air pressure every 2 s; the colour TFT shows them with icons and bars. Change the air in the BME280 inspector.');
  p.parts = [
    part('bme1', 'bme280', 'BME280 1', 14, -40, 3),
    part('tft1', 'st7735', 'TFT 1', -24, -52, 3),
  ];
  p.wires = [
    w('bme1.VCC', `${B}.3V3`, C.power), w('bme1.GND', `${B}.GND_R`, C.ground), w('bme1.SCL', `${B}.GPIO22`, C.scl), w('bme1.SDA', `${B}.GPIO21`, C.sda),
    w('tft1.VCC', `${B}.3V3`, C.power), w('tft1.GND', `${B}.GND_R`, C.ground), w('tft1.CS', `${B}.GPIO5`, C.other), w('tft1.RST', `${B}.GPIO17`, C.other),
    w('tft1.DC', `${B}.GPIO16`, C.signal), w('tft1.SDA', `${B}.GPIO23`, C.data), w('tft1.SCK', `${B}.GPIO18`, C.scl), w('tft1.LED', `${B}.3V3`, C.power),
  ];
  p.program = {
    pins: {}, i2c: { sda: 21, scl: 22 }, vars: [], lists: {}, sprites: {},
    devices: [{ id: 'bme', kind: 'bme280', part: 'bme1', address: 0x76 }, { id: 'tft', kind: 'tft', part: 'tft1', cs: 5, dc: 16, rst: 17 }],
    rules: [
      rule({ name: 'Draw the frame', trigger: { kind: 'start' }, actions: [
        act({ kind: 'tftFill', device: 'tft', color: '#000000' }),
        act({ kind: 'tftRect', device: 'tft', x: 0, y: 0, w: 128, h: 22, color: '#1f4e8c', fill: true }),
        act({ kind: 'tftText', device: 'tft', x: 6, y: 4, size: 2, color: '#ffffff', text: 'WEATHER' }),
        act({ kind: 'tftSprite', device: 'tft', sprite: 'thermo', x: 2, y: 30, scale: 1 }),
        act({ kind: 'tftSprite', device: 'tft', sprite: 'drop', x: 2, y: 62, scale: 1 }),
        act({ kind: 'tftSprite', device: 'tft', sprite: 'cloud', x: 2, y: 94, scale: 1 }),
      ] }),
      rule({ name: 'Every 2 s: measure and show', trigger: { kind: 'every', ms: 2000, immediate: true }, actions: [
        act({ kind: 'readBme', device: 'bme', temp: 'temp', hum: 'hum', pres: 'pres' }),
        act({ kind: 'tftRect', device: 'tft', x: 22, y: 28, w: 106, h: 92, color: '#000000', fill: true }),
        act({ kind: 'tftText', device: 'tft', x: 24, y: 32, size: 2, color: '#ff9f1c', text: '{temp:1}°C' }),
        act({ kind: 'tftText', device: 'tft', x: 24, y: 64, size: 2, color: '#4aa3ff', text: '{hum:0} %' }),
        act({ kind: 'tftText', device: 'tft', x: 24, y: 98, size: 1, color: '#ffffff', text: '{pres:1} hPa' }),
        act({ kind: 'tftBar', device: 'tft', x: 4, y: 128, w: 120, h: 10, value: v('temp'), max: 40, color: '#ff9f1c' }),
        act({ kind: 'tftBar', device: 'tft', x: 4, y: 144, w: 120, h: 10, value: v('hum'), max: 100, color: '#4aa3ff' }),
        act({ kind: 'serialPrint', text: '{temp:1} C, {hum:0} %, {pres:1} hPa' }),
      ] }),
      rule({ name: 'Weather icon', trigger: { kind: 'every', ms: 2000, immediate: true }, conditions: [cmp(v('hum'), '>=', num(75))],
        actions: [act({ kind: 'tftSprite', device: 'tft', sprite: 'rain', x: 104, y: 3, scale: 1 })],
        elseActions: [act({ kind: 'tftSprite', device: 'tft', sprite: 'sun', x: 104, y: 3, scale: 1 })] }),
    ],
  };
  return p;
}

/* ---------------- crypto ticker (simulated prices) ---------------- */
export function cryptoTicker(): Project {
  const p = base('Crypto ticker (simulated prices)', 'crypto-ticker', 'Shows a price that changes every second, with an up/down arrow. Offline, the prices are SIMULATED (a seeded random walk), and the screen says so. Press the button to switch coin.');
  p.parts = [
    part('tft1', 'st7735', 'TFT 1', -24, -52, 3),
    part('btn1', 'button', 'Button 1', 14, -38, 0, { cap: 'yellow' }),
  ];
  p.wires = [
    w('tft1.VCC', `${B}.3V3`, C.power), w('tft1.GND', `${B}.GND_R`, C.ground), w('tft1.CS', `${B}.GPIO5`, C.other), w('tft1.RST', `${B}.GPIO17`, C.other),
    w('tft1.DC', `${B}.GPIO16`, C.signal), w('tft1.SDA', `${B}.GPIO23`, C.data), w('tft1.SCK', `${B}.GPIO18`, C.scl), w('tft1.LED', `${B}.3V3`, C.power),
    w('btn1.1a', `${B}.GPIO4`, C.signal), w('btn1.2b', `${B}.GND_R`, C.ground),
  ];
  const show = (coin: number, feed: string, label: string, color: string): Rule => rule({
    name: `Every second: ${label}`, trigger: { kind: 'every', ms: 1000, immediate: true }, conditions: [cmp(v('coin'), '==', num(coin))],
    actions: [
      act({ kind: 'setVar', name: 'price', op: 'set', value: { kind: 'feed', feed } }),
      act({ kind: 'tftRect', device: 'tft', x: 0, y: 34, w: 128, h: 56, color: '#000000', fill: true }),
      act({ kind: 'tftSprite', device: 'tft', sprite: 'coin', x: 4, y: 36, scale: 1 }),
      act({ kind: 'tftText', device: 'tft', x: 26, y: 40, size: 1, color, text: label }),
      act({ kind: 'tftText', device: 'tft', x: 4, y: 62, size: 2, color: '#ffffff', text: '${price:0}' }),
      act({ kind: 'serialPrint', text: `${label} {price:2} (simulated)` }),
    ],
  });
  p.program = {
    pins: { 4: 'INPUT_PULLUP' }, i2c: { sda: 21, scl: 22 }, lists: {}, sprites: {},
    vars: [{ name: 'coin', initial: 0 }, { name: 'price', initial: 0 }, { name: 'last', initial: 0 }],
    devices: [{ id: 'tft', kind: 'tft', part: 'tft1', cs: 5, dc: 16, rst: 17 }],
    rules: [
      rule({ name: 'Title and the SIMULATED notice', trigger: { kind: 'start' }, actions: [
        act({ kind: 'tftFill', device: 'tft', color: '#000000' }),
        act({ kind: 'tftText', device: 'tft', x: 4, y: 6, size: 2, color: '#f7931a', text: 'TICKER' }),
        act({ kind: 'tftRect', device: 'tft', x: 0, y: 140, w: 128, h: 20, color: '#8a1c1c', fill: true }),
        act({ kind: 'tftText', device: 'tft', x: 4, y: 146, size: 1, color: '#ffffff', text: 'SIMULATED PRICES' }),
      ] }),
      show(0, 'btc', 'BTC/USD', '#f7931a'),
      show(1, 'eth', 'ETH/USD', '#8c8cff'),
      rule({ name: 'Arrow: up or down since last second', trigger: { kind: 'every', ms: 1000, immediate: true }, conditions: [cmp(v('price'), '>=', v('last'))],
        actions: [act({ kind: 'tftSprite', device: 'tft', sprite: 'up', x: 100, y: 96, scale: 1 }), act({ kind: 'tftText', device: 'tft', x: 4, y: 100, size: 1, color: '#35d07f', text: 'rising ' })],
        elseActions: [act({ kind: 'tftSprite', device: 'tft', sprite: 'down', x: 100, y: 96, scale: 1 }), act({ kind: 'tftText', device: 'tft', x: 4, y: 100, size: 1, color: '#ff5a4f', text: 'falling' })] }),
      rule({ name: 'Remember the price', trigger: { kind: 'every', ms: 1000, immediate: true }, actions: [act({ kind: 'setVar', name: 'last', op: 'set', value: v('price') })] }),
      rule({ name: 'Button: switch coin', trigger: { kind: 'pinEdge', pin: 4, edge: 'falling' }, conditions: [cmp(v('coin'), '==', num(0))],
        actions: [act({ kind: 'setVar', name: 'coin', op: 'set', value: num(1) }), act({ kind: 'setVar', name: 'last', op: 'set', value: num(0) })],
        elseActions: [act({ kind: 'setVar', name: 'coin', op: 'set', value: num(0) }), act({ kind: 'setVar', name: 'last', op: 'set', value: num(0) })] }),
    ],
  };
  return p;
}

/* ---------------- lyric display ---------------- */
export function lyricDisplay(): Project {
  const p = base('Lyric display', 'lyrics', 'Steps through a text list on the OLED, one line every 1.5 s, with a note on the passive buzzer for each line. The button pauses it. Edit the lines in the Behaviour tab.');
  p.parts = [
    part('oled1', 'ssd1306', 'OLED 1', -22, -46, 3),
    part('btn1', 'button', 'Button 1', 12, -38, 0, { cap: 'blue' }),
    part('pz1', 'buzzer-passive', 'Piezo 1', 28, -36, 0),
  ];
  p.wires = [
    w('oled1.VCC', `${B}.3V3`, C.power), w('oled1.GND', `${B}.GND_R`, C.ground), w('oled1.SCL', `${B}.GPIO22`, C.scl), w('oled1.SDA', `${B}.GPIO21`, C.sda),
    w('btn1.1a', `${B}.GPIO4`, C.signal), w('btn1.2b', `${B}.GND_R`, C.ground),
    w('pz1.P', `${B}.GPIO19`, C.other), w('pz1.N', `${B}.GND_R`, C.ground),
  ];
  p.program = {
    pins: { 4: 'INPUT_PULLUP' }, i2c: { sda: 21, scl: 22 }, sprites: {},
    vars: [{ name: 'i', initial: 0 }, { name: 'next', initial: 1 }, { name: 'paused', initial: 0 }],
    lists: { lyrics: ['Wires hum soft tunes', 'Electrons in rows', 'A blink and a beep', 'The board still glows', 'Press to pause me', 'Press to sing again'] },
    devices: [{ id: 'oled', kind: 'ssd1306', part: 'oled1', address: 0x3c }],
    rules: [
      rule({ name: 'Every 1.5 s: next line', trigger: { kind: 'every', ms: 1500, immediate: true }, conditions: [cmp(v('paused'), '==', num(0))], actions: [
        act({ kind: 'setVar', name: 'next', op: 'set', value: v('i') }),
        act({ kind: 'setVar', name: 'next', op: 'add', value: num(1) }),
        act({ kind: 'oledClear', device: 'oled' }),
        act({ kind: 'oledText', device: 'oled', x: 0, y: 0, size: 1, text: '~ LYRICS ~' }),
        act({ kind: 'oledText', device: 'oled', x: 0, y: 22, size: 1, text: '> {lyrics[i]}' }),
        act({ kind: 'oledText', device: 'oled', x: 0, y: 44, size: 1, text: '  {lyrics[next]}' }),
        act({ kind: 'tone', pin: 19, freq: { kind: 'map', value: v('i'), inMin: 0, inMax: 5, outMin: 392, outMax: 784 }, ms: 180 }),
        act({ kind: 'serialPrint', text: '{lyrics[i]}' }),
        act({ kind: 'setVar', name: 'i', op: 'add', value: num(1) }),
      ] }),
      rule({ name: 'Wrap round at the end', trigger: { kind: 'every', ms: 1500, immediate: true }, conditions: [cmp(v('i'), '>=', { kind: 'listLen', list: 'lyrics' })], actions: [act({ kind: 'setVar', name: 'i', op: 'set', value: num(0) })] }),
      rule({ name: 'Button: pause / resume', trigger: { kind: 'pinEdge', pin: 4, edge: 'falling' }, conditions: [cmp(v('paused'), '==', num(0))],
        actions: [act({ kind: 'setVar', name: 'paused', op: 'set', value: num(1) }), act({ kind: 'oledText', device: 'oled', x: 86, y: 0, size: 1, text: 'PAUSE' })],
        elseActions: [act({ kind: 'setVar', name: 'paused', op: 'set', value: num(0) })] }),
    ],
  };
  return p;
}

/* ---------------- servo gate ---------------- */
export function servoGate(): Project {
  const p = base('Servo gate', 'servo-gate', 'Press the button to raise or lower a barrier on an SG90 servo. The servo runs from VIN (5 V); only its signal comes from a GPIO.');
  p.parts = [
    part('sv1', 'servo', 'Servo 1', 10, -48, 3, { horn: 'gate' }),
    part('btn1', 'button', 'Button 1', -24, -36, 0, { cap: 'red' }),
  ];
  p.wires = [
    w('sv1.VCC', `${B}.VIN`, C.power), w('sv1.GND', `${B}.GND_R`, C.ground), w('sv1.SIG', `${B}.GPIO19`, C.signal),
    w('btn1.1a', `${B}.GPIO4`, C.data), w('btn1.2b', `${B}.GND_R`, C.ground),
  ];
  p.program = {
    pins: { 4: 'INPUT_PULLUP' }, i2c: { sda: 21, scl: 22 }, lists: {}, sprites: {}, devices: [],
    vars: [{ name: 'open', initial: 0 }],
    rules: [
      rule({ name: 'Start closed', trigger: { kind: 'start' }, actions: [act({ kind: 'servoWrite', pin: 19, angle: num(0) })] }),
      rule({ name: 'Button: open or close', trigger: { kind: 'pinEdge', pin: 4, edge: 'falling' }, conditions: [cmp(v('open'), '==', num(0))],
        actions: [act({ kind: 'servoWrite', pin: 19, angle: num(90) }), act({ kind: 'setVar', name: 'open', op: 'set', value: num(1) }), act({ kind: 'serialPrint', text: 'Gate opening' })],
        elseActions: [act({ kind: 'servoWrite', pin: 19, angle: num(0) }), act({ kind: 'setVar', name: 'open', op: 'set', value: num(0) }), act({ kind: 'serialPrint', text: 'Gate closing' })] }),
    ],
  };
  return p;
}

/* shared: L298N + battery + motor wired to ENA = 23, IN1 = 22, IN2 = 21 */
function motorRig(p: Project, attachment: 'wheel' | 'fan') {
  p.parts.push(
    part('drv1', 'l298n', 'Driver 1', -10, -60, 1),
    part('m1', 'dcmotor', 'Motor 1', -95, -70, 0, { attachment, load: attachment === 'fan' ? 15 : 25 }),
    part('bat1', 'battery', 'Battery 1', -20, -125, 1, { kind: 'aa4' }),
  );
  p.wires.push(
    w('bat1.POS', 'drv1.VS', C.power), w('bat1.NEG', 'drv1.GND', C.ground), w('drv1.GND', `${B}.GND_R`, C.ground),
    w('m1.M1', 'drv1.OUT1', C.other), w('m1.M2', 'drv1.OUT2', C.other),
    w('drv1.ENA', `${B}.GPIO23`, C.signal), w('drv1.IN1', `${B}.GPIO22`, C.data), w('drv1.IN2', `${B}.GPIO21`, C.scl),
  );
}

/* ---------------- motor speed and direction ---------------- */
export function motorController(): Project {
  const p = base('DC motor speed & direction', 'motor', 'Turn the knob to set the speed (PWM on ENA); press the button to reverse. The motor gets its power from the battery through the L298N; the ESP32 only sends logic signals, and the grounds are shared.');
  p.parts = [part('pot1', 'pot', 'Knob 1', 30, -40, 0, { position: 60 }), part('btn1', 'button', 'Button 1', 48, -38, 0, { cap: 'black' })];
  p.wires = [
    w('pot1.A', `${B}.GND_R`, C.ground), w('pot1.B', `${B}.3V3`, C.power), w('pot1.W', `${B}.GPIO34`, C.other),
    w('btn1.1a', `${B}.GPIO4`, C.signal), w('btn1.2b', `${B}.GND_R`, C.ground),
  ];
  motorRig(p, 'wheel');
  p.program = {
    pins: { 4: 'INPUT_PULLUP', 21: 'OUTPUT', 22: 'OUTPUT', 23: 'OUTPUT' }, i2c: { sda: 21, scl: 22 }, lists: {}, sprites: {}, devices: [],
    vars: [{ name: 'dir', initial: 0 }, { name: 'speed', initial: 0 }],
    rules: [
      rule({ name: 'Start forward', trigger: { kind: 'start' }, actions: [act({ kind: 'digitalWrite', pin: 22, value: 'HIGH' }), act({ kind: 'digitalWrite', pin: 21, value: 'LOW' })] }),
      rule({ name: 'Every 100 ms: knob → speed', trigger: { kind: 'every', ms: 100, immediate: true }, actions: [
        act({ kind: 'setVar', name: 'speed', op: 'set', value: { kind: 'map', value: { kind: 'analogRead', pin: 34 }, inMin: 0, inMax: 4095, outMin: 0, outMax: 255 } }),
        act({ kind: 'pwmWrite', pin: 23, duty: v('speed') }),
      ] }),
      rule({ name: 'Every second: report', trigger: { kind: 'every', ms: 1000 }, actions: [act({ kind: 'serialPrint', text: 'speed {speed} / 255, direction {dir}' })] }),
      rule({ name: 'Button: reverse', trigger: { kind: 'pinEdge', pin: 4, edge: 'falling' }, conditions: [cmp(v('dir'), '==', num(0))],
        actions: [act({ kind: 'setVar', name: 'dir', op: 'set', value: num(1) }), act({ kind: 'digitalWrite', pin: 22, value: 'LOW' }), act({ kind: 'digitalWrite', pin: 21, value: 'HIGH' })],
        elseActions: [act({ kind: 'setVar', name: 'dir', op: 'set', value: num(0) }), act({ kind: 'digitalWrite', pin: 22, value: 'HIGH' }), act({ kind: 'digitalWrite', pin: 21, value: 'LOW' })] }),
    ],
  };
  return p;
}

/* ---------------- temperature-triggered fan and alarm ---------------- */
export function tempFan(): Project {
  const p = base('Temperature fan & alarm', 'temp-fan', 'A DHT22 checks the air every 2 s. Above 28 °C the fan (motor through the L298N) spins; above 35 °C the active buzzer sounds too. Raise the temperature in the DHT22 inspector to try it.');
  p.parts = [part('dht1', 'dht22', 'DHT22 1', 35, -44, 1, { temperature: 24, humidity: 50 }), part('bz1', 'buzzer-active', 'Buzzer 1', 56, -38, 0)];
  p.wires = [
    w('dht1.VCC', `${B}.3V3`, C.power), w('dht1.DATA', `${B}.GPIO4`, C.data), w('dht1.GND', `${B}.GND_R`, C.ground),
    w('bz1.P', `${B}.GPIO19`, C.signal), w('bz1.N', `${B}.GND_R`, C.ground),
  ];
  motorRig(p, 'fan');
  p.program = {
    pins: { 19: 'OUTPUT', 21: 'OUTPUT', 22: 'OUTPUT', 23: 'OUTPUT' }, i2c: { sda: 21, scl: 22 }, lists: {}, sprites: {},
    vars: [{ name: 'temp', initial: 0 }, { name: 'hum', initial: 0 }],
    devices: [{ id: 'dht', kind: 'dht', part: 'dht1', model: 'DHT22', pin: 4 }],
    rules: [
      rule({ name: 'Fan direction', trigger: { kind: 'start' }, actions: [act({ kind: 'digitalWrite', pin: 22, value: 'HIGH' }), act({ kind: 'digitalWrite', pin: 21, value: 'LOW' })] }),
      rule({ name: 'Every 2 s: measure', trigger: { kind: 'every', ms: 2000, immediate: true }, actions: [act({ kind: 'readDht', device: 'dht', temp: 'temp', hum: 'hum' }), act({ kind: 'serialPrint', text: 'Temperature {temp:1} C' })] }),
      rule({ name: 'Fan above 28 °C', trigger: { kind: 'every', ms: 2000, immediate: true }, conditions: [cmp(v('temp'), '>=', num(28))],
        actions: [act({ kind: 'digitalWrite', pin: 23, value: 'HIGH' })], elseActions: [act({ kind: 'digitalWrite', pin: 23, value: 'LOW' })] }),
      rule({ name: 'Alarm above 35 °C', trigger: { kind: 'every', ms: 2000, immediate: true }, conditions: [cmp(v('temp'), '>=', num(35))],
        actions: [act({ kind: 'digitalWrite', pin: 19, value: 'HIGH' }), act({ kind: 'serialPrint', text: 'TOO HOT!' })], elseActions: [act({ kind: 'digitalWrite', pin: 19, value: 'LOW' })] }),
    ],
  };
  return p;
}

/* ---------------- night light ---------------- */
export function nightLight(): Project {
  const p = base('Night light (LDR)', 'night-light', 'An LDR and a 10 kΩ resistor make a light-dependent voltage on GPIO34. The darker it gets, the brighter the LED (PWM). Change the light level in the LDR inspector.');
  p.parts = [
    part('ldr1', 'ldr', 'LDR 1', 12, -36, 0, { lux: 400 }),
    part('r2', 'resistor', 'R 2', 26, -40, 1, { ohms: 10000 }),
    part('r1', 'resistor', 'R 1', -22, -34, 0, { ohms: 220 }),
    part('led1', 'led', 'LED 1', -8, -40, 0, { color: 'yellow' }),
  ];
  p.wires = [
    w('ldr1.1', `${B}.3V3`, C.power), w('ldr1.2', `${B}.GPIO34`, C.other), w('ldr1.2', 'r2.1', C.other), w('r2.2', `${B}.GND_R`, C.ground),
    w(`${B}.GPIO23`, 'r1.1', C.data), w('r1.2', 'led1.A', C.signal), w('led1.K', `${B}.GND_R`, C.ground),
  ];
  p.program = {
    pins: { 23: 'OUTPUT' }, i2c: { sda: 21, scl: 22 }, lists: {}, sprites: {}, devices: [],
    vars: [{ name: 'light', initial: 0 }],
    rules: [
      rule({ name: 'Every 100 ms: darker → brighter LED', trigger: { kind: 'every', ms: 100, immediate: true }, actions: [
        act({ kind: 'setVar', name: 'light', op: 'set', value: { kind: 'analogRead', pin: 34 } }),
        act({ kind: 'pwmWrite', pin: 23, duty: { kind: 'map', value: v('light'), inMin: 0, inMax: 4095, outMin: 255, outMax: 0 } }),
      ] }),
      rule({ name: 'Every second: report', trigger: { kind: 'every', ms: 1000 }, actions: [act({ kind: 'serialPrint', text: 'light reading {light} of 4095' })] }),
    ],
  };
  return p;
}

/* ---------------- motion alarm ---------------- */
export function motionAlarm(): Project {
  const p = base('Motion alarm (PIR)', 'motion', 'An HC-SR501 PIR (powered from VIN) raises GPIO18 when something moves; the buzzer and LED follow it. Hold "Wave in front" in the PIR inspector.');
  p.parts = [
    part('pir1', 'pir', 'PIR 1', 10, -48, 1),
    part('bz1', 'buzzer-active', 'Buzzer 1', 34, -36, 0),
    part('r1', 'resistor', 'R 1', -22, -34, 0, { ohms: 330 }),
    part('led1', 'led', 'LED 1', -8, -40, 0, { color: 'red' }),
  ];
  p.wires = [
    w('pir1.VCC', `${B}.VIN`, C.power), w('pir1.OUT', `${B}.GPIO18`, C.signal), w('pir1.GND', `${B}.GND_R`, C.ground),
    w('bz1.P', `${B}.GPIO19`, C.other), w('bz1.N', `${B}.GND_R`, C.ground),
    w(`${B}.GPIO23`, 'r1.1', C.data), w('r1.2', 'led1.A', C.signal), w('led1.K', `${B}.GND_R`, C.ground),
  ];
  p.program = {
    pins: { 18: 'INPUT', 19: 'OUTPUT', 23: 'OUTPUT' }, i2c: { sda: 21, scl: 22 }, lists: {}, sprites: {}, devices: [], vars: [],
    rules: [
      rule({ name: 'PIR changes → alarm follows', trigger: { kind: 'pinEdge', pin: 18, edge: 'change' }, conditions: [cmp({ kind: 'digitalRead', pin: 18 }, '==', num(1))],
        actions: [act({ kind: 'digitalWrite', pin: 19, value: 'HIGH' }), act({ kind: 'digitalWrite', pin: 23, value: 'HIGH' }), act({ kind: 'serialPrint', text: 'Motion detected!' })],
        elseActions: [act({ kind: 'digitalWrite', pin: 19, value: 'LOW' }), act({ kind: 'digitalWrite', pin: 23, value: 'LOW' }), act({ kind: 'serialPrint', text: 'All quiet' })] }),
    ],
  };
  return p;
}

/* ---------------- RGB mood light ---------------- */
export function moodLight(): Project {
  const p = base('RGB mood light', 'rgb', 'Three PWM pins drive the red, green and blue parts of an RGB LED (common cathode) through their own resistors. Every 0.8 s it picks a new random colour.');
  p.parts = [
    part('rgb1', 'rgb', 'RGB 1', 0, -44, 0),
    part('rr', 'resistor', 'R red', -26, -36, 0, { ohms: 220 }),
    part('rg', 'resistor', 'R green', -14, -56, 0, { ohms: 220 }),
    part('rb', 'resistor', 'R blue', 18, -36, 0, { ohms: 220 }),
  ];
  p.wires = [
    w(`${B}.GPIO23`, 'rr.1', C.power), w('rr.2', 'rgb1.R', C.power),
    w(`${B}.GPIO22`, 'rg.1', C.scl), w('rg.2', 'rgb1.G', C.scl),
    w(`${B}.GPIO21`, 'rb.1', C.data), w('rb.2', 'rgb1.B', C.data),
    w('rgb1.K', `${B}.GND_R`, C.ground),
  ];
  p.program = {
    pins: { 21: 'OUTPUT', 22: 'OUTPUT', 23: 'OUTPUT' }, i2c: { sda: 21, scl: 22 }, lists: {}, sprites: {}, devices: [], vars: [],
    rules: [
      rule({ name: 'Every 0.8 s: a new colour', trigger: { kind: 'every', ms: 800, immediate: true }, actions: [
        act({ kind: 'pwmWrite', pin: 23, duty: { kind: 'random', min: 0, max: 255 } }),
        act({ kind: 'pwmWrite', pin: 22, duty: { kind: 'random', min: 0, max: 255 } }),
        act({ kind: 'pwmWrite', pin: 21, duty: { kind: 'random', min: 0, max: 255 } }),
      ] }),
    ],
  };
  return p;
}

export const EXAMPLES = [
  { id: 'weather-tft', name: 'Weather station (TFT + BME280)', summary: 'Temperature, humidity and pressure on a colour screen with icons and bars.', parts: ['BME280', 'ST7735 TFT'], build: weatherTft },
  { id: 'crypto-ticker', name: 'Crypto ticker (simulated prices)', summary: 'A changing price with up/down arrows. Offline prices are clearly marked as simulated.', parts: ['ST7735 TFT', 'Button'], build: cryptoTicker },
  { id: 'lyrics', name: 'Lyric display', summary: 'Steps through your own lines on the OLED, with a note per line; the button pauses.', parts: ['SSD1306 OLED', 'Button', 'Passive buzzer'], build: lyricDisplay },
  { id: 'servo-gate', name: 'Servo gate', summary: 'A button raises and lowers a barrier on an SG90 servo.', parts: ['SG90 servo', 'Button'], build: servoGate },
  { id: 'motor', name: 'DC motor speed & direction', summary: 'Knob → PWM speed, button → reverse, through an L298N with a battery.', parts: ['TT motor', 'L298N', 'Battery', 'Knob', 'Button'], build: motorController },
  { id: 'temp-fan', name: 'Temperature fan & alarm', summary: 'Fan above 28 °C, buzzer above 35 °C.', parts: ['DHT22', 'TT motor + fan', 'L298N', 'Battery', 'Active buzzer'], build: tempFan },
  { id: 'night-light', name: 'Night light (LDR)', summary: 'The darker the room, the brighter the LED.', parts: ['LDR', '10 kΩ', 'LED'], build: nightLight },
  { id: 'motion', name: 'Motion alarm (PIR)', summary: 'Buzzer and LED when the PIR sees movement.', parts: ['HC-SR501 PIR', 'Active buzzer', 'LED'], build: motionAlarm },
  { id: 'rgb', name: 'RGB mood light', summary: 'Random colours from three PWM channels.', parts: ['RGB LED', '3 × 220 Ω'], build: moodLight },
];

registerTemplates(EXAMPLES);
