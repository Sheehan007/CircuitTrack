// Stage-2 parts: BME280, ST7735 TFT, SG90 servo, TT DC motor, L298N motor driver, battery pack, buzzers.
import type { Element } from '../solver';
import type { ComponentDef, ElectricalCtx } from './types';

const load = (c: ElectricalCtx, a: string, b: string, ma: number, nominal = 3.3, name = 'load'): Element =>
  ({ kind: 'R', id: c.id(name), a: c.node(a), b: c.node(b), ohms: nominal / (ma / 1000) });

/* ---------------- BME280 (3.3 V breakout, no regulator) ---------------- */
export const bme280: ComponentDef = {
  type: 'bme280',
  name: 'BME280 temp / humidity / pressure (I²C)',
  category: 'Sensors',
  summary: 'Bosch environmental sensor on I²C at 0x76 (or 0x77). This breakout has no regulator: 3.3 V only.',
  status: 'ready',
  labelPrefix: 'BME280',
  device: 'bme280',
  bounds: [[-7.4, -7.6, 0], [7.4, 7.6, 10]],
  terminals: [
    { id: 'VCC', label: 'VCC', pos: [-5.6, 3.81, 9.2], kind: 'power', description: '1.71–3.6 V. Wire to 3V3: VIN (5 V) would damage this breakout.' },
    { id: 'GND', label: 'GND', pos: [-5.6, 1.27, 9.2], kind: 'ground', description: 'Ground.' },
    { id: 'SCL', label: 'SCL', pos: [-5.6, -1.27, 9.2], kind: 'signal', description: 'I²C clock (GPIO22 by default).' },
    { id: 'SDA', label: 'SDA', pos: [-5.6, -3.81, 9.2], kind: 'signal', description: 'I²C data (GPIO21 by default).' },
  ],
  params: [
    { key: 'address', label: 'I²C address', kind: 'select', group: 'config', options: [{ value: 0x76, label: '0x76 (SDO to GND, default)' }, { value: 0x77, label: '0x77 (SDO to VCC)' }] },
    { key: 'temperature', label: 'Air temperature', kind: 'number', group: 'environment', min: -40, max: 85, step: 0.5, unit: '°C' },
    { key: 'humidity', label: 'Relative humidity', kind: 'number', group: 'environment', min: 0, max: 100, step: 1, unit: '%RH' },
    { key: 'pressure', label: 'Air pressure', kind: 'number', group: 'environment', min: 300, max: 1100, step: 1, unit: 'hPa', help: '1013 hPa at sea level; it falls about 12 hPa per 100 m of altitude.' },
  ],
  defaults: { address: 0x76, temperature: 21, humidity: 45, pressure: 1013 },
  power: { vcc: 'VCC', gnd: 'GND', minV: 1.71, maxV: 3.6, typicalMa: 0.7 },
  electrical: (c) => [
    load(c, 'VCC', 'GND', 0.7),
    { kind: 'R', id: c.id('pu_sda'), a: c.node('SDA'), b: c.node('VCC'), ohms: 10_000 },
    { kind: 'R', id: c.id('pu_scl'), a: c.node('SCL'), b: c.node('VCC'), ohms: 10_000 },
  ],
  specs: (p) => [['Temperature', '−40…85 °C, ±1 °C'], ['Humidity', '0–100 %RH, ±3 %'], ['Pressure', '300–1100 hPa, ±1 hPa'], ['Interface', `I²C at 0x${Number(p.address).toString(16).toUpperCase()}`], ['Supply', '1.71–3.6 V (no regulator on this breakout)']],
  alt: () => 'Small purple BME280 breakout with a tiny metal sensor can and four pins: VCC, GND, SCL, SDA.',
};

/* ---------------- ST7735 1.8" colour TFT (SPI) ---------------- */
export const st7735: ComponentDef = {
  type: 'st7735',
  name: 'ST7735 1.8" colour TFT (SPI)',
  category: 'Displays',
  summary: '128 × 160 colour LCD on SPI: SCK → GPIO18, SDA (MOSI) → GPIO23, plus CS, DC (A0) and RESET pins. LED is the backlight.',
  status: 'ready',
  labelPrefix: 'TFT',
  device: 'tft',
  bounds: [[-28.5, -17.2, 0], [28.5, 17.2, 10]],
  terminals: [
    { id: 'VCC', label: 'VCC', pos: [-26, 8.89, 9.6], kind: 'power', description: '3.3–5 V (the module has a regulator).' },
    { id: 'GND', label: 'GND', pos: [-26, 6.35, 9.6], kind: 'ground', description: 'Ground.' },
    { id: 'CS', label: 'CS', pos: [-26, 3.81, 9.6], kind: 'signal', description: 'Chip select: any free GPIO (GPIO5 is the default SPI SS).' },
    { id: 'RST', label: 'RESET', pos: [-26, 1.27, 9.6], kind: 'signal', description: 'Reset: a GPIO, or tie it to 3V3.' },
    { id: 'DC', label: 'A0 (DC)', pos: [-26, -1.27, 9.6], kind: 'signal', description: 'Data/command select: any free GPIO.' },
    { id: 'SDA', label: 'SDA (MOSI)', pos: [-26, -3.81, 9.6], kind: 'signal', description: 'SPI data in. Hardware SPI: GPIO23.' },
    { id: 'SCK', label: 'SCK', pos: [-26, -6.35, 9.6], kind: 'signal', description: 'SPI clock. Hardware SPI: GPIO18.' },
    { id: 'LED', label: 'LED', pos: [-26, -8.89, 9.6], kind: 'power', description: 'Backlight: 3V3 for always on, or a GPIO to switch/dim it.' },
  ],
  params: [],
  defaults: {},
  power: { vcc: 'VCC', gnd: 'GND', minV: 3.0, maxV: 5.5, typicalMa: 8 },
  electrical: (c) => [
    load(c, 'VCC', 'GND', 8),
    { kind: 'R', id: c.id('backlight'), a: c.node('LED'), b: c.node('GND'), ohms: 150 },
    ...['CS', 'RST', 'DC', 'SDA', 'SCK'].map((t): Element => ({ kind: 'R', id: c.id(`in_${t}`), a: c.node(t), b: c.node('GND'), ohms: 1_000_000 })),
  ],
  specs: () => [['Resolution', '128 × 160 px, 16-bit colour'], ['Controller', 'ST7735S'], ['Interface', 'SPI (write only)'], ['Supply', '3.3–5 V'], ['Backlight', '~20 mA on the LED pin']],
  alt: () => '1.8 inch colour TFT module on a red board, with eight pins along one short edge.',
};

/* ---------------- SG90 micro servo ---------------- */
export const servo: ComponentDef = {
  type: 'servo',
  name: 'SG90 micro servo',
  category: 'Actuators',
  summary: 'Turns its horn to an angle (0–180°) set by a 50 Hz pulse on the orange wire. Power it from 5 V (VIN).',
  status: 'ready',
  labelPrefix: 'Servo',
  device: 'servo',
  bounds: [[-26, -14, 0], [24, 14, 32]],
  terminals: [
    { id: 'GND', label: 'GND (brown)', pos: [-24, 2.54, 9], kind: 'ground', description: 'Brown wire: ground, shared with the ESP32.' },
    { id: 'VCC', label: 'V+ (red)', pos: [-24, 0, 9], kind: 'power', description: 'Red wire: 4.8–6 V. VIN works over USB; 3.3 V is too weak.' },
    { id: 'SIG', label: 'Signal (orange)', pos: [-24, -2.54, 9], kind: 'signal', description: 'Orange wire: the position pulse (500–2400 µs every 20 ms) from any output GPIO.' },
  ],
  params: [
    { key: 'horn', label: 'Horn', kind: 'select', group: 'config', options: [{ value: 'arm', label: 'Single arm' }, { value: 'pointer', label: 'Long pointer (gauge)' }, { value: 'gate', label: 'Gate barrier' }] },
  ],
  defaults: { horn: 'arm' },
  power: { vcc: 'VCC', gnd: 'GND', minV: 4.0, maxV: 6.0, typicalMa: 10 },
  electrical: (c) => [
    // idle draw, or ~200 mA while the motor is turning
    load(c, 'VCC', 'GND', c.state?.moving ? 200 : 10, 5),
    { kind: 'R', id: c.id('sig'), a: c.node('SIG'), b: c.node('GND'), ohms: 100_000 },
  ],
  specs: () => [['Range', '0–180°'], ['Speed', '0.1 s / 60° at 4.8 V'], ['Supply', '4.8–6 V; ~10 mA idle, ~200 mA moving, ~650 mA stalled'], ['Signal', '50 Hz, 544–2400 µs (ESP32Servo defaults)']],
  alt: (p) => `Blue SG90 micro servo with a white ${p.horn === 'pointer' ? 'pointer' : p.horn === 'gate' ? 'gate barrier' : 'arm'} on its output shaft and a brown, red and orange lead.`,
};

/* ---------------- TT gear motor (DC) ---------------- */
export const dcMotor: ComponentDef = {
  type: 'dcmotor',
  name: 'DC gear motor (TT, 3–6 V)',
  category: 'Actuators',
  summary: 'Yellow hobby gear motor. Needs far more current than a GPIO can give: drive it through a motor driver.',
  status: 'ready',
  labelPrefix: 'Motor',
  device: 'motor',
  bounds: [[-22, -23, 0], [57, 14, 25]],
  terminals: [
    { id: 'M1', label: 'Motor +', pos: [55, 1.27, 9], kind: 'passive', description: 'Swap the two wires to reverse it.' },
    { id: 'M2', label: 'Motor −', pos: [55, -1.27, 9], kind: 'passive', description: 'Swap the two wires to reverse it.' },
  ],
  params: [
    { key: 'attachment', label: 'On the shaft', kind: 'select', group: 'config', options: [{ value: 'wheel', label: 'Wheel' }, { value: 'fan', label: 'Fan blade' }] },
    { key: 'load', label: 'Mechanical load', kind: 'number', group: 'environment', min: 0, max: 100, step: 5, unit: '%', help: '0 = spinning freely, 100 = stalled. More load: slower, more current.' },
  ],
  defaults: { attachment: 'wheel', load: 20 },
  electrical: (c) => {
    // Winding resistance plus back-EMF folded into an equivalent resistance: little current when free, a lot when stalled.
    const lf = Math.max(0.12, Number(c.params.load ?? 20) / 100);
    return [{ kind: 'R', id: c.id('coil'), a: c.node('M1'), b: c.node('M2'), ohms: 7.5 / lf }];
  },
  specs: () => [['Rated voltage', '3–6 V'], ['No-load speed', '~200 rpm at 6 V (after the 1:48 gearbox)'], ['Current', '~150 mA free, ~1 A stalled'], ['Winding', '~7.5 Ω']],
  alt: (p) => `Yellow TT gear motor with a ${p.attachment === 'fan' ? 'fan blade' : 'wheel'} on its shaft and two wires.`,
};

/* ---------------- L298N dual H-bridge module ---------------- */
const IN_TERMS = ['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB'];
export const l298n: ComponentDef = {
  type: 'l298n',
  name: 'L298N motor driver',
  category: 'Actuators',
  summary: 'Dual H-bridge: IN1/IN2 set direction, PWM on ENA sets speed. Motor power comes from its own 12 V terminal.',
  status: 'ready',
  labelPrefix: 'Driver',
  device: 'driver',
  bounds: [[-21.5, -21.5, 0], [21.5, 21.5, 28]],
  terminals: [
    { id: 'VS', label: '+12V (motor supply)', pos: [18.5, 13, 10], kind: 'power', description: 'Motor supply, 5–35 V from a battery pack. Not from the ESP32.' },
    { id: 'GND', label: 'GND', pos: [18.5, 8, 10], kind: 'ground', description: 'Battery − and ESP32 GND both go here: the ground must be shared.' },
    { id: 'V5', label: '+5V', pos: [18.5, 3, 10], kind: 'power', description: 'With the 5V jumper on and ≥7 V on +12V, this is a 5 V output.' },
    ...IN_TERMS.map((id, i) => ({ id, label: id, pos: [19.5, -3 - i * 2.54, 10.6] as [number, number, number], kind: 'signal' as const, description: id.startsWith('EN') ? `Enable / speed for motor ${id === 'ENA' ? 'A' : 'B'}: HIGH = on, PWM = speed.` : `Direction input for motor ${['IN1', 'IN2'].includes(id) ? 'A' : 'B'}. 3.3 V logic is enough (it needs > 2.3 V).` })),
    { id: 'OUT1', label: 'OUT1', pos: [-4, 19, 10], kind: 'passive', description: 'Motor A terminal 1.' },
    { id: 'OUT2', label: 'OUT2', pos: [-9, 19, 10], kind: 'passive', description: 'Motor A terminal 2.' },
    { id: 'OUT3', label: 'OUT3', pos: [-9, -19, 10], kind: 'passive', description: 'Motor B terminal 1.' },
    { id: 'OUT4', label: 'OUT4', pos: [-4, -19, 10], kind: 'passive', description: 'Motor B terminal 2.' },
  ],
  params: [
    { key: 'jumper5v', label: '5V regulator jumper fitted', kind: 'boolean', group: 'config', help: 'With it on, the module makes its own 5 V from +12V (and +5V becomes an output).' },
  ],
  defaults: { jumper5v: true },
  electrical: (c) => {
    const els: Element[] = IN_TERMS.map((t) => ({ kind: 'R', id: c.id(`in_${t}`), a: c.node(t), b: c.node('GND'), ohms: 47_000 }));
    els.push(load(c, 'VS', 'GND', 10, 12, 'quiescent'));
    const vs = c.volts('VS'), g = c.volts('GND');
    if (vs == null || g == null) return els;
    const supply = vs - g;
    if (c.params.jumper5v && supply >= 7) els.push({ kind: 'V', id: c.id('reg5'), p: c.node('V5'), n: c.node('GND'), volts: 5, ohms: 0.5 });
    // logic inputs are judged against the driver's own ground (the H-bridge only switches if that ground is shared)
    const hi = (t: string) => { const v = c.volts(t); return v != null && v - g > 2.3; };
    const bridge = (en: string, a: string, b: string, oa: string, ob: string) => {
      if (!hi(en) || supply < 4.5) return;
      const level = (on: boolean) => (on ? Math.max(0, supply - 1.4) : 0.5);
      els.push({ kind: 'V', id: c.id(`${oa}`), p: c.node(oa), n: c.node('GND'), volts: level(hi(a)), ohms: 0.6 });
      els.push({ kind: 'V', id: c.id(`${ob}`), p: c.node(ob), n: c.node('GND'), volts: level(hi(b)), ohms: 0.6 });
    };
    bridge('ENA', 'IN1', 'IN2', 'OUT1', 'OUT2');
    bridge('ENB', 'IN3', 'IN4', 'OUT3', 'OUT4');
    return els;
  },
  specs: () => [['Channels', '2 (motor A and B)'], ['Motor supply', '5–35 V, up to 2 A per channel'], ['Voltage drop', '~1.4–2 V (bipolar transistors)'], ['Logic', 'HIGH > 2.3 V: works from 3.3 V GPIOs'], ['5 V regulator', 'on board (78M05), jumper selectable']],
  alt: () => 'Red L298N motor driver module with a large black heatsink, blue screw terminals for the motors and power, and a row of six control pins.',
};

/* ---------------- battery pack ---------------- */
export const BATTERIES: Record<string, { volts: number; label: string; ohms: number }> = {
  aa4: { volts: 6, label: '4 × AA (6 V)', ohms: 0.6 },
  aa3: { volts: 4.5, label: '3 × AA (4.5 V)', ohms: 0.45 },
  li2s: { volts: 7.4, label: '2 × 18650 Li-ion (7.4 V)', ohms: 0.15 },
  v9: { volts: 9, label: '9 V block', ohms: 1.5 },
  v12: { volts: 12, label: '12 V adapter', ohms: 0.1 },
};
export const battery: ComponentDef = {
  type: 'battery',
  name: 'Battery pack',
  category: 'Prototyping',
  summary: 'External supply for motors and other hungry loads. Share its − with the ESP32 GND.',
  status: 'ready',
  labelPrefix: 'Battery',
  bounds: [[-31, -29, 0], [38, 29, 17]],
  terminals: [
    { id: 'POS', label: '+ (red)', pos: [35, 1.27, 9], kind: 'power', description: 'Positive lead.' },
    { id: 'NEG', label: '− (black)', pos: [35, -1.27, 9], kind: 'ground', description: 'Negative lead: connect to the ESP32 GND as well as the driver GND.' },
  ],
  params: [{ key: 'kind', label: 'Pack', kind: 'select', group: 'config', options: Object.entries(BATTERIES).map(([value, b]) => ({ value, label: b.label })) }],
  defaults: { kind: 'aa4' },
  electrical: (c) => {
    const b = BATTERIES[c.params.kind as string] ?? BATTERIES.aa4;
    return [{ kind: 'V', id: c.id('cells'), p: c.node('POS'), n: c.node('NEG'), volts: b.volts, ohms: b.ohms }];
  },
  specs: (p) => { const b = BATTERIES[p.kind as string] ?? BATTERIES.aa4; return [['Voltage', `${b.volts} V`], ['Internal resistance', `~${b.ohms} Ω`]]; },
  alt: (p) => `Battery holder: ${(BATTERIES[p.kind as string] ?? BATTERIES.aa4).label}, with a red and a black lead.`,
};

/* ---------------- buzzers ---------------- */
const buzzer = (active: boolean): ComponentDef => ({
  type: active ? 'buzzer-active' : 'buzzer-passive',
  name: active ? 'Active buzzer' : 'Passive buzzer (piezo)',
  category: 'Outputs',
  summary: active
    ? 'Has its own oscillator: beeps at one pitch whenever its + leg is HIGH.'
    : 'No oscillator: it only sounds when driven with a tone (tone(pin, Hz)). A steady HIGH just clicks.',
  status: 'ready',
  insertable: true,
  labelPrefix: active ? 'Buzzer' : 'Piezo',
  device: active ? 'buzzer-active' : 'buzzer-passive',
  bounds: [[-6.2, -6.2, 0], [6.2, 6.2, 13]],
  terminals: [
    { id: 'P', label: '+ (long leg)', pos: [0, 3.81, 0.4], kind: 'passive', description: active ? 'To a GPIO (or through a transistor for more volume).' : 'To the GPIO that plays the tone.' },
    { id: 'N', label: '−', pos: [0, -3.81, 0.4], kind: 'passive', description: 'To GND.' },
  ],
  params: [],
  defaults: {},
  electrical: (c) => [{ kind: 'R', id: c.id('coil'), a: c.node('P'), b: c.node('N'), ohms: active ? 150 : 1000 }],
  specs: () => active
    ? [['Pitch', '~2.3 kHz (fixed)'], ['Supply', '3–5 V, ~20 mA'], ['Drive', 'DC: HIGH = beep']]
    : [['Pitch', 'whatever you play: ~100 Hz–5 kHz'], ['Drive', 'square wave (tone())'], ['Load', 'piezo, ~1 kΩ effective']],
  alt: () => `Black round ${active ? 'active' : 'passive'} buzzer with two legs, the longer one positive.`,
});
export const buzzerActive = buzzer(true);
export const buzzerPassive = buzzer(false);
