/*
  The supported Arduino-ESP32 API: constants, functions, global objects (Serial, Wire, ESP) and library classes
  (Adafruit_SSD1306, Adafruit_ST7735, Adafruit_BME280, DHT, Servo). Every entry has a checked signature (used by the
  compiler for errors and by the editor for autocomplete) and an implementation that reaches the simulator only through
  FwHost. Anything not listed here is reported as unsupported at compile time.
*/
import type { ColorFramebuffer } from '../devices/colorFramebuffer';
import { Gfx, color565 } from './gfx';
import { formatPrint, formatPrintf } from './printf';
import { T, type CType, type Kind } from './types';
import { Fault, Restart, Sleep, type CallSite, type VM } from './vm';

/** The simulator, as the sketch sees it. Implemented by the firmware runner on top of the engine. */
export interface FwHost {
  millis(): number;
  micros(): number;
  pinMode(pin: number, mode: number): void;
  digitalWrite(pin: number, v: number): void;
  digitalRead(pin: number): number;
  analogRead(pin: number, bits: number): number;
  analogReadMilliVolts(pin: number): number;
  /** PWM with duty 0…1 at a frequency (Hz). */
  pwm(pin: number, duty: number, freq: number): void;
  tone(pin: number, hz: number, ms: number): void;
  noTone(pin: number): void;
  servoUs(pin: number, us: number): void;
  serialBegin(baud: number): void;
  serialWrite(text: string): void;
  serialAvailable(): number;
  serialRead(): number;
  serialPeek(): number;
  random(): number;
  reseed(seed: number): void;
  attachInterrupt(pin: number, fn: number, mode: number): void;
  detachInterrupt(pin: number): void;
  wireBegin(sda: number, scl: number): void;
  i2cProbe(addr: number): boolean;
  oledShow(addr: number, pixels: Uint8Array): void;
  bmeProbe(addr: number): boolean;
  bmeRead(addr: number): { temperature: number; humidity: number; pressure: number } | null;
  dhtRead(pin: number, model: number): { temperature: number; humidity: number } | null;
  tftTarget(t: { cs: number; dc: number; rst: number; mosi: number; sck: number }): ColorFramebuffer | null;
  restart(): void;
  warn(code: string, title: string, detail: string, fix?: string): void;
}

/** Parameter kinds: 'arr' = a numeric array, 'arrnum' = an array or a number (for overloads). */
export type PSpec = 'int' | 'num' | 'any' | 'text' | 'bool' | 'func' | 'obj' | 'arr' | 'arrnum';

export interface NativeSpec {
  params: PSpec[];
  /** How many trailing params may be left out. */
  opt?: number;
  varargs?: boolean;
  ret: CType | ((args: CType[]) => CType);
  run: (vm: VM, args: unknown[], site: CallSite) => unknown;
  doc: string;
  /** String methods that change the receiver in place (toUpperCase, trim, …). */
  mutates?: boolean;
}

export interface ClassSpec {
  name: string;
  header: string;
  ctor: { params: PSpec[]; opt?: number; doc: string; run: (args: unknown[], vm: VM) => object };
  methods: Record<string, NativeSpec>;
}

const H = (vm: VM) => vm.host as FwHost;
const n = (v: unknown) => Number(v);
const VOID = undefined;

/* ---------------- constants ---------------- */

export const CONSTANTS: Record<string, { value: number; type: CType }> = {};
const C = (names: Record<string, number>, type: CType = T.i32) => { for (const [k, v] of Object.entries(names)) CONSTANTS[k] = { value: v, type }; };
C({ HIGH: 1, LOW: 0, INPUT: 0x01, OUTPUT: 0x03, INPUT_PULLUP: 0x05, INPUT_PULLDOWN: 0x09, OUTPUT_OPEN_DRAIN: 0x13 });
C({ RISING: 0x01, FALLING: 0x02, CHANGE: 0x03, ONLOW: 0x04, ONHIGH: 0x05 });
C({ LED_BUILTIN: 2, BUILTIN_LED: 2, DEC: 10, HEX: 16, OCT: 8, BIN: 2, NULL: 0 });
C({ A0: 36, A3: 39, A4: 32, A5: 33, A6: 34, A7: 35, A10: 4, A12: 2, A13: 15, A14: 13, A15: 12, A16: 14, A17: 27, A18: 25, A19: 26 });
C({ SSD1306_SWITCHCAPVCC: 2, SSD1306_EXTERNALVCC: 1, SSD1306_WHITE: 1, SSD1306_BLACK: 0, SSD1306_INVERSE: 2, WHITE: 1, BLACK: 0, INVERSE: 2 });
C({ INITR_GREENTAB: 0, INITR_REDTAB: 1, INITR_BLACKTAB: 2, INITR_144GREENTAB: 1, INITR_MINI160x80: 4 });
C({ DHT11: 11, DHT22: 22, DHT21: 21, AM2301: 21 });
C({ INT_MAX: 2147483647, INT_MIN: -2147483648 });
C({ UINT32_MAX: 4294967295, ULONG_MAX: 4294967295 }, T.u32);
const colors: Record<string, number> = { BLACK: 0x0000, WHITE: 0xffff, RED: 0xf800, GREEN: 0x07e0, BLUE: 0x001f, CYAN: 0x07ff, MAGENTA: 0xf81f, YELLOW: 0xffe0, ORANGE: 0xfc00 };
for (const [k, v] of Object.entries(colors)) { CONSTANTS[`ST77XX_${k}`] = { value: v, type: { k: 'num', n: 'u16' } }; CONSTANTS[`ST7735_${k}`] = { value: v, type: { k: 'num', n: 'u16' } }; }
for (const [k, v] of Object.entries({ PI: Math.PI, HALF_PI: Math.PI / 2, TWO_PI: Math.PI * 2, DEG_TO_RAD: Math.PI / 180, RAD_TO_DEG: 180 / Math.PI, EULER: Math.E, NAN: NaN, INFINITY: Infinity })) CONSTANTS[k] = { value: v, type: T.f64 };

/* ---------------- includes ---------------- */

export const HEADERS: Record<string, string | null> = {
  'Arduino.h': null, 'Wire.h': null, 'SPI.h': null, 'Adafruit_GFX.h': null, 'Adafruit_SSD1306.h': null, 'Adafruit_ST7735.h': null,
  'Adafruit_ST77xx.h': null, 'Adafruit_Sensor.h': null, 'Adafruit_BME280.h': null, 'DHT.h': null, 'DHT_U.h': null, 'ESP32Servo.h': null,
  'math.h': null, 'stdint.h': null, 'stdlib.h': null, 'stdio.h': null,
  'WiFi.h': 'Wi-Fi is not simulated yet.', 'WiFiClient.h': 'Wi-Fi is not simulated yet.', 'WebServer.h': 'Wi-Fi is not simulated yet.',
  'HTTPClient.h': 'Wi-Fi is not simulated yet.', 'PubSubClient.h': 'Networking (MQTT) is not simulated yet.', 'BluetoothSerial.h': 'Bluetooth is not simulated yet.',
  'BLEDevice.h': 'Bluetooth LE is not simulated yet.', 'Preferences.h': 'Preferences / NVS storage is not simulated yet.', 'EEPROM.h': 'EEPROM is not simulated yet.',
  'Servo.h': 'On the ESP32 use #include <ESP32Servo.h> (the AVR Servo library does not support the ESP32).',
  'Adafruit_NeoPixel.h': 'NeoPixels are not in the parts library yet.', 'FastLED.h': 'NeoPixels are not in the parts library yet.',
  'LiquidCrystal_I2C.h': 'Character LCDs are not in the parts library yet.', 'U8g2lib.h': 'U8g2 is not supported: use Adafruit_SSD1306.',
  'TFT_eSPI.h': 'TFT_eSPI is not supported: use Adafruit_ST7735.', 'Adafruit_ST7789.h': 'The ST7789 is not in the parts library yet: use the ST7735.',
  'freertos/FreeRTOS.h': 'FreeRTOS tasks are not simulated yet.', 'string.h': 'C string functions (strcpy, strcmp, …) are not supported: use String.',
};

/* ---------------- printing (shared by Serial and the displays) ---------------- */

function printSpecs(out: (vm: VM, self: unknown, text: string) => void): Record<string, NativeSpec> {
  return {
    print: { params: ['any', 'int'], opt: 1, ret: T.void, doc: 'print(value[, base or decimals])', run: (vm, a, s) => out(vm, a[0], formatPrint(a[1], s.kinds[1], a.length > 2 ? n(a[2]) : undefined)) },
    println: { params: ['any', 'int'], opt: 2, ret: T.void, doc: 'println([value[, base or decimals]])', run: (vm, a, s) => out(vm, a[0], (a.length > 1 ? formatPrint(a[1], s.kinds[1], a.length > 2 ? n(a[2]) : undefined) : '') + '\n') },
    printf: { params: ['text'], varargs: true, ret: T.i32, doc: 'printf(format, ...)', run: (vm, a) => { const t = formatPrintf(String(a[1]), a.slice(2)); out(vm, a[0], t); return t.length; } },
    write: { params: ['any'], ret: T.i32, doc: 'write(byte or text)', run: (vm, a, s) => { const t = s.kinds[1] === 'str' ? String(a[1]) : String.fromCharCode(n(a[1]) & 0xff); out(vm, a[0], t); return t.length; } },
  };
}

/* ---------------- global functions ---------------- */

const ledcState = new WeakMap<VM, { pins: Map<number, { freq: number; res: number }>; channels: Map<number, { freq: number; res: number; pins: Set<number> }>; adcBits: number }>();
const ledc = (vm: VM) => {
  let s = ledcState.get(vm);
  if (!s) { s = { pins: new Map(), channels: new Map(), adcBits: 12 }; ledcState.set(vm, s); }
  return s;
};

const mathFn = (f: (...x: number[]) => number, params: PSpec[], doc: string): NativeSpec => ({ params, ret: T.f64, doc, run: (_vm, a) => f(...a.map(n)) });
const sameAsArgs = (args: CType[]): CType => {
  // min/max/abs/constrain keep the operands' (promoted) type, like the Arduino macros
  if (args.some((t) => t.k === 'num' && (t.n === 'f64'))) return T.f64;
  if (args.some((t) => t.k === 'num' && t.n === 'f32')) return T.f32;
  if (args.some((t) => t.k === 'num' && t.n === 'u32')) return T.u32;
  if (args.some((t) => t.k === 'num' && (t.n === 'i64' || t.n === 'u64'))) return T.i64;
  return T.i32;
};

export const FUNCTIONS: Record<string, NativeSpec> = {
  pinMode: { params: ['int', 'int'], ret: T.void, doc: 'pinMode(pin, INPUT | OUTPUT | INPUT_PULLUP | INPUT_PULLDOWN)', run: (vm, a) => H(vm).pinMode(n(a[0]), n(a[1])) },
  digitalWrite: { params: ['int', 'int'], ret: T.void, doc: 'digitalWrite(pin, HIGH | LOW)', run: (vm, a) => H(vm).digitalWrite(n(a[0]), n(a[1]) ? 1 : 0) },
  digitalRead: { params: ['int'], ret: T.i32, doc: 'digitalRead(pin) → HIGH or LOW', run: (vm, a) => H(vm).digitalRead(n(a[0])) },
  analogRead: { params: ['int'], ret: { k: 'num', n: 'u16' }, doc: 'analogRead(pin) → 0…4095 (12-bit ADC)', run: (vm, a) => H(vm).analogRead(n(a[0]), ledc(vm).adcBits) },
  analogReadMilliVolts: { params: ['int'], ret: T.u32, doc: 'analogReadMilliVolts(pin) → mV', run: (vm, a) => H(vm).analogReadMilliVolts(n(a[0])) },
  analogReadResolution: { params: ['int'], ret: T.void, doc: 'analogReadResolution(bits) 9…12', run: (vm, a) => { ledc(vm).adcBits = Math.max(9, Math.min(12, n(a[0]))); } },
  analogWrite: { params: ['int', 'int'], ret: T.void, doc: 'analogWrite(pin, 0…255) → LEDC PWM at 1 kHz', run: (vm, a) => H(vm).pwm(n(a[0]), Math.max(0, Math.min(255, n(a[1]))) / 255, 1000) },
  delay: { params: ['num'], ret: T.void, doc: 'delay(ms)', run: (_vm, a) => new Sleep(Math.max(0, n(a[0]))) },
  delayMicroseconds: { params: ['num'], ret: T.void, doc: 'delayMicroseconds(us)', run: (_vm, a) => new Sleep(Math.max(0, n(a[0])) / 1000) },
  millis: { params: [], ret: T.u32, doc: 'millis() → ms since boot', run: (vm) => H(vm).millis() >>> 0 },
  micros: { params: [], ret: T.u32, doc: 'micros() → µs since boot', run: (vm) => H(vm).micros() >>> 0 },
  yield: { params: [], ret: T.void, doc: 'yield()', run: () => VOID },
  // LEDC, Arduino-ESP32 core 3.x (pin based)
  ledcAttach: { params: ['int', 'num', 'int'], ret: T.bool, doc: 'ledcAttach(pin, freq, resolutionBits) (core 3.x)', run: (vm, a) => { ledc(vm).pins.set(n(a[0]), { freq: n(a[1]), res: n(a[2]) }); H(vm).pwm(n(a[0]), 0, n(a[1])); return 1; } },
  ledcAttachChannel: { params: ['int', 'num', 'int', 'int'], ret: T.bool, doc: 'ledcAttachChannel(pin, freq, bits, channel) (core 3.x)', run: (vm, a) => { ledc(vm).pins.set(n(a[0]), { freq: n(a[1]), res: n(a[2]) }); H(vm).pwm(n(a[0]), 0, n(a[1])); return 1; } },
  ledcWrite: {
    params: ['int', 'num'], ret: T.bool, doc: 'ledcWrite(pin, duty) (core 3.x) / ledcWrite(channel, duty) (core 2.x)',
    run: (vm, a) => {
      const s = ledc(vm), id = n(a[0]), duty = n(a[1]);
      const ch = s.channels.get(id);
      if (ch && !s.pins.has(id)) { for (const p of ch.pins) H(vm).pwm(p, Math.min(1, duty / ((1 << ch.res) - 1)), ch.freq); return 1; }
      const p = s.pins.get(id);
      if (!p) return new Fault(`ledcWrite(${id}, …): pin ${id} was never set up with ledcAttach(pin, freq, bits).`);
      H(vm).pwm(id, Math.min(1, duty / ((1 << p.res) - 1)), p.freq);
      return 1;
    },
  },
  ledcWriteTone: { params: ['int', 'num'], ret: T.u32, doc: 'ledcWriteTone(pin, freq)', run: (vm, a) => { const f = n(a[1]); if (f > 0) H(vm).tone(n(a[0]), f, 0); else H(vm).noTone(n(a[0])); return f; } },
  ledcDetach: { params: ['int'], ret: T.bool, doc: 'ledcDetach(pin)', run: (vm, a) => { ledc(vm).pins.delete(n(a[0])); H(vm).pwm(n(a[0]), 0, 0); return 1; } },
  // LEDC, Arduino-ESP32 core 2.x (channel based) — still common in tutorials
  ledcSetup: { params: ['int', 'num', 'int'], ret: T.u32, doc: 'ledcSetup(channel, freq, bits) (core 2.x)', run: (vm, a) => { ledc(vm).channels.set(n(a[0]), { freq: n(a[1]), res: n(a[2]), pins: new Set() }); return n(a[1]); } },
  ledcAttachPin: { params: ['int', 'int'], ret: T.void, doc: 'ledcAttachPin(pin, channel) (core 2.x)', run: (vm, a) => { const ch = ledc(vm).channels.get(n(a[1])); if (!ch) return new Fault(`ledcAttachPin: channel ${n(a[1])} was not set up with ledcSetup().`); ch.pins.add(n(a[0])); H(vm).pwm(n(a[0]), 0, ch.freq); return VOID; } },
  ledcDetachPin: { params: ['int'], ret: T.void, doc: 'ledcDetachPin(pin) (core 2.x)', run: (vm, a) => { for (const ch of ledc(vm).channels.values()) ch.pins.delete(n(a[0])); H(vm).pwm(n(a[0]), 0, 0); } },
  tone: { params: ['int', 'num', 'num'], opt: 1, ret: T.void, doc: 'tone(pin, frequency[, durationMs])', run: (vm, a) => H(vm).tone(n(a[0]), n(a[1]), a.length > 2 ? n(a[2]) : 0) },
  noTone: { params: ['int'], ret: T.void, doc: 'noTone(pin)', run: (vm, a) => H(vm).noTone(n(a[0])) },
  attachInterrupt: { params: ['int', 'func', 'int'], ret: T.void, doc: 'attachInterrupt(digitalPinToInterrupt(pin), isr, RISING | FALLING | CHANGE)', run: (vm, a) => H(vm).attachInterrupt(n(a[0]), n(a[1]), n(a[2])) },
  detachInterrupt: { params: ['int'], ret: T.void, doc: 'detachInterrupt(pin)', run: (vm, a) => H(vm).detachInterrupt(n(a[0])) },
  digitalPinToInterrupt: { params: ['int'], ret: T.i32, doc: 'digitalPinToInterrupt(pin)', run: (_vm, a) => n(a[0]) },
  interrupts: { params: [], ret: T.void, doc: 'interrupts()', run: () => VOID },
  noInterrupts: { params: [], ret: T.void, doc: 'noInterrupts()', run: () => VOID },
  map: { params: ['num', 'num', 'num', 'num', 'num'], ret: T.i32, doc: 'map(value, fromLow, fromHigh, toLow, toHigh)', run: (_vm, a) => { const [x, i0, i1, o0, o1] = a.map((v) => Math.trunc(n(v))); return i1 === i0 ? o0 : Math.trunc(((x - i0) * (o1 - o0)) / (i1 - i0)) + o0; } },
  constrain: { params: ['num', 'num', 'num'], ret: sameAsArgs, doc: 'constrain(x, low, high)', run: (_vm, a) => Math.min(Math.max(n(a[0]), n(a[1])), n(a[2])) },
  min: { params: ['num', 'num'], ret: sameAsArgs, doc: 'min(a, b)', run: (_vm, a) => Math.min(n(a[0]), n(a[1])) },
  max: { params: ['num', 'num'], ret: sameAsArgs, doc: 'max(a, b)', run: (_vm, a) => Math.max(n(a[0]), n(a[1])) },
  abs: { params: ['num'], ret: sameAsArgs, doc: 'abs(x)', run: (_vm, a) => Math.abs(n(a[0])) },
  sq: { params: ['num'], ret: sameAsArgs, doc: 'sq(x)', run: (_vm, a) => n(a[0]) * n(a[0]) },
  pow: mathFn(Math.pow, ['num', 'num'], 'pow(base, exponent)'),
  sqrt: mathFn(Math.sqrt, ['num'], 'sqrt(x)'),
  sin: mathFn(Math.sin, ['num'], 'sin(radians)'),
  cos: mathFn(Math.cos, ['num'], 'cos(radians)'),
  tan: mathFn(Math.tan, ['num'], 'tan(radians)'),
  asin: mathFn(Math.asin, ['num'], 'asin(x)'),
  acos: mathFn(Math.acos, ['num'], 'acos(x)'),
  atan: mathFn(Math.atan, ['num'], 'atan(x)'),
  atan2: mathFn(Math.atan2, ['num', 'num'], 'atan2(y, x)'),
  exp: mathFn(Math.exp, ['num'], 'exp(x)'),
  log: mathFn(Math.log, ['num'], 'log(x)'),
  log10: mathFn(Math.log10, ['num'], 'log10(x)'),
  floor: mathFn(Math.floor, ['num'], 'floor(x)'),
  ceil: mathFn(Math.ceil, ['num'], 'ceil(x)'),
  round: mathFn((x) => (x < 0 ? -Math.round(-x) : Math.round(x)), ['num'], 'round(x)'),
  fabs: mathFn(Math.abs, ['num'], 'fabs(x)'),
  fmod: mathFn((x, y) => x % y, ['num', 'num'], 'fmod(x, y)'),
  fmin: mathFn(Math.min, ['num', 'num'], 'fmin(a, b)'),
  fmax: mathFn(Math.max, ['num', 'num'], 'fmax(a, b)'),
  isnan: { params: ['num'], ret: T.bool, doc: 'isnan(x)', run: (_vm, a) => (Number.isNaN(n(a[0])) ? 1 : 0) },
  isinf: { params: ['num'], ret: T.bool, doc: 'isinf(x)', run: (_vm, a) => (Math.abs(n(a[0])) === Infinity ? 1 : 0) },
  random: { params: ['num', 'num'], opt: 1, ret: T.i32, doc: 'random(max) or random(min, max): min ≤ n < max', run: (vm, a) => { const lo = a.length > 1 ? n(a[0]) : 0, hi = a.length > 1 ? n(a[1]) : n(a[0]); return hi <= lo ? lo : Math.floor(lo + H(vm).random() * (hi - lo)); } },
  randomSeed: { params: ['num'], ret: T.void, doc: 'randomSeed(seed)', run: (vm, a) => H(vm).reseed(n(a[0])) },
  bitRead: { params: ['int', 'int'], ret: T.i32, doc: 'bitRead(value, bit)', run: (_vm, a) => (n(a[0]) >>> n(a[1])) & 1 },
  bit: { params: ['int'], ret: T.u32, doc: 'bit(n) → 1 << n', run: (_vm, a) => (1 << n(a[0])) >>> 0 },
  lowByte: { params: ['int'], ret: T.u8, doc: 'lowByte(x)', run: (_vm, a) => n(a[0]) & 0xff },
  highByte: { params: ['int'], ret: T.u8, doc: 'highByte(x)', run: (_vm, a) => (n(a[0]) >> 8) & 0xff },
  F: { params: ['text'], ret: T.cstr, doc: 'F("text") (flash string; same as the text here)', run: (_vm, a) => a[0] },
  esp_restart: { params: [], ret: T.void, doc: 'esp_restart()', run: () => new Restart() },
};

const UNSUPPORTED_FUNCTIONS: Record<string, string> = {
  touchRead: 'Capacitive touch is not simulated yet.',
  dacWrite: 'The DAC (GPIO25/26) is not simulated yet: use PWM (analogWrite / ledcWrite).',
  pulseIn: 'pulseIn() is not supported yet.',
  shiftOut: 'shiftOut() is not supported yet.',
  shiftIn: 'shiftIn() is not supported yet.',
  xTaskCreate: 'FreeRTOS tasks are not simulated yet: put the work in loop().',
  xTaskCreatePinnedToCore: 'FreeRTOS tasks are not simulated yet: put the work in loop().',
  vTaskDelay: 'vTaskDelay is not supported: use delay().',
  malloc: 'Dynamic memory (malloc) is not supported.',
  free: 'Dynamic memory (free) is not supported.',
  strcpy: 'C string functions are not supported: use String.',
  strcmp: 'C string functions are not supported: use String and ==.',
  strlen: 'C string functions are not supported: use String and .length().',
  sprintf: 'sprintf into a char buffer is not supported: use Serial.printf, or build a String.',
  snprintf: 'snprintf into a char buffer is not supported: use Serial.printf, or build a String.',
  bitSet: 'bitSet() changes its argument in place, which is not supported: write x |= (1 << n).',
  bitClear: 'bitClear() changes its argument in place, which is not supported: write x &= ~(1 << n).',
  bitWrite: 'bitWrite() changes its argument in place, which is not supported: use |= and &= with (1 << n).',
  deepSleep: 'Deep sleep is not simulated yet.',
  esp_deep_sleep_start: 'Deep sleep is not simulated yet.',
};
export const unsupportedFunction = (name: string) => UNSUPPORTED_FUNCTIONS[name];

/* ---------------- String methods ---------------- */

export const STRING_METHODS: Record<string, NativeSpec> = {
  length: { params: [], ret: T.u32, doc: 'length()', run: (_vm, a) => String(a[0]).length },
  toInt: { params: [], ret: T.i32, doc: 'toInt()', run: (_vm, a) => { const m = String(a[0]).trim().match(/^[-+]?\d+/); return m ? Number(m[0]) | 0 : 0; } },
  toFloat: { params: [], ret: T.f32, doc: 'toFloat()', run: (_vm, a) => { const v = parseFloat(String(a[0])); return Number.isNaN(v) ? 0 : Math.fround(v); } },
  indexOf: { params: ['any', 'int'], opt: 1, ret: T.i32, doc: 'indexOf(text or char[, from])', run: (_vm, a, s) => String(a[0]).indexOf(s.kinds[1] === 'str' ? String(a[1]) : String.fromCharCode(n(a[1])), a.length > 2 ? n(a[2]) : 0) },
  substring: { params: ['int', 'int'], opt: 1, ret: T.String, doc: 'substring(from[, to])', run: (_vm, a) => String(a[0]).substring(n(a[1]), a.length > 2 ? n(a[2]) : undefined) },
  charAt: { params: ['int'], ret: T.char, doc: 'charAt(index)', run: (_vm, a) => String(a[0]).charCodeAt(n(a[1])) || 0 },
  equals: { params: ['text'], ret: T.bool, doc: 'equals(other)', run: (_vm, a) => (String(a[0]) === String(a[1]) ? 1 : 0) },
  equalsIgnoreCase: { params: ['text'], ret: T.bool, doc: 'equalsIgnoreCase(other)', run: (_vm, a) => (String(a[0]).toLowerCase() === String(a[1]).toLowerCase() ? 1 : 0) },
  startsWith: { params: ['text'], ret: T.bool, doc: 'startsWith(prefix)', run: (_vm, a) => (String(a[0]).startsWith(String(a[1])) ? 1 : 0) },
  endsWith: { params: ['text'], ret: T.bool, doc: 'endsWith(suffix)', run: (_vm, a) => (String(a[0]).endsWith(String(a[1])) ? 1 : 0) },
  c_str: { params: [], ret: T.cstr, doc: 'c_str()', run: (_vm, a) => String(a[0]) },
  toUpperCase: { params: [], ret: T.void, mutates: true, doc: 'toUpperCase() (changes the String)', run: (_vm, a) => String(a[0]).toUpperCase() },
  toLowerCase: { params: [], ret: T.void, mutates: true, doc: 'toLowerCase() (changes the String)', run: (_vm, a) => String(a[0]).toLowerCase() },
  trim: { params: [], ret: T.void, mutates: true, doc: 'trim() (changes the String)', run: (_vm, a) => String(a[0]).trim() },
  concat: { params: ['any'], ret: T.void, mutates: true, doc: 'concat(value) (appends)', run: (_vm, a, s) => String(a[0]) + formatPrint(a[1], s.kinds[1]) },
  replace: { params: ['text', 'text'], ret: T.void, mutates: true, doc: 'replace(find, with) (changes the String)', run: (_vm, a) => String(a[0]).split(String(a[1])).join(String(a[2])) },
};

/* ---------------- global objects & classes ---------------- */

const serialOut = (vm: VM, _self: unknown, text: string) => H(vm).serialWrite(text);

export const CLASSES: Record<string, ClassSpec> = {
  HardwareSerial: {
    name: 'HardwareSerial', header: 'Arduino.h',
    ctor: { params: [], doc: '', run: () => ({ cls: 'HardwareSerial' }) },
    methods: {
      begin: { params: ['num', 'int', 'int', 'int'], opt: 3, ret: T.void, doc: 'begin(baud)', run: (vm, a) => H(vm).serialBegin(n(a[1])) },
      end: { params: [], ret: T.void, doc: 'end()', run: () => VOID },
      available: { params: [], ret: T.i32, doc: 'available() → bytes waiting', run: (vm) => H(vm).serialAvailable() },
      read: { params: [], ret: T.i32, doc: 'read() → next byte or -1', run: (vm) => H(vm).serialRead() },
      peek: { params: [], ret: T.i32, doc: 'peek()', run: (vm) => H(vm).serialPeek() },
      readString: { params: [], ret: T.String, doc: 'readString()', run: (vm) => { let s = ''; for (let c = H(vm).serialRead(); c >= 0; c = H(vm).serialRead()) s += String.fromCharCode(c); return s; } },
      readStringUntil: { params: ['int'], ret: T.String, doc: "readStringUntil('\\n')", run: (vm, a) => { let s = ''; for (let c = H(vm).serialRead(); c >= 0 && c !== n(a[1]); c = H(vm).serialRead()) s += String.fromCharCode(c); return s; } },
      parseInt: { params: [], ret: T.i32, doc: 'parseInt()', run: (vm) => parseNumber(vm, false) },
      parseFloat: { params: [], ret: T.f32, doc: 'parseFloat()', run: (vm) => parseNumber(vm, true) },
      flush: { params: [], ret: T.void, doc: 'flush()', run: () => VOID },
      setTimeout: { params: ['num'], ret: T.void, doc: 'setTimeout(ms)', run: () => VOID },
      ...printSpecs(serialOut),
    },
  },
  TwoWire: {
    name: 'TwoWire', header: 'Wire.h',
    ctor: { params: [], doc: '', run: () => ({ cls: 'TwoWire', addr: -1 }) },
    methods: {
      begin: { params: ['int', 'int', 'num'], opt: 3, ret: T.bool, doc: 'begin([sda, scl[, frequency]])', run: (vm, a) => { H(vm).wireBegin(a.length > 2 ? n(a[1]) : 21, a.length > 2 ? n(a[2]) : 22); return 1; } },
      setClock: { params: ['num'], ret: T.void, doc: 'setClock(hz)', run: () => VOID },
      beginTransmission: { params: ['int'], ret: T.void, doc: 'beginTransmission(address)', run: (_vm, a) => { (a[0] as { addr: number }).addr = n(a[1]); } },
      write: { params: ['int'], ret: T.i32, doc: 'write(byte)', run: () => 1 },
      endTransmission: { params: ['bool'], opt: 1, ret: T.u8, doc: 'endTransmission() → 0 ok, 2 no answer', run: (vm, a) => (H(vm).i2cProbe((a[0] as { addr: number }).addr) ? 0 : 2) },
    },
  },
  EspClass: {
    name: 'EspClass', header: 'Arduino.h',
    ctor: { params: [], doc: '', run: () => ({ cls: 'EspClass' }) },
    methods: {
      restart: { params: [], ret: T.void, doc: 'restart()', run: () => new Restart() },
      getFreeHeap: { params: [], ret: T.u32, doc: 'getFreeHeap()', run: () => 280_000 },
      getChipModel: { params: [], ret: T.cstr, doc: 'getChipModel()', run: () => 'ESP32-D0WD-V3 (simulated)' },
      getCpuFreqMHz: { params: [], ret: T.u32, doc: 'getCpuFreqMHz()', run: () => 240 },
    },
  },
  Adafruit_SSD1306: {
    name: 'Adafruit_SSD1306', header: 'Adafruit_SSD1306.h',
    ctor: {
      params: ['int', 'int', 'obj', 'int'], opt: 4, doc: 'Adafruit_SSD1306 display(128, 64, &Wire, -1);',
      run: (a) => {
        const w = a.length >= 2 ? n(a[0]) : 128, h = a.length >= 2 ? n(a[1]) : 64;
        const buf = new Uint8Array(128 * 64);
        const gfx = new Gfx(w, h, (x, y, c) => { if (x < 128 && y < 64) { const i = y * 128 + x; buf[i] = c === 2 ? buf[i] ^ 1 : c ? 1 : 0; } });
        return { cls: 'Adafruit_SSD1306', w, h, buf, gfx, addr: 0x3c, inverted: false };
      },
    },
    methods: { ...gfxMethods(), ...printSpecs((_vm, self, text) => (self as { gfx: Gfx }).gfx.write(text)),
      begin: { params: ['int', 'int', 'bool', 'bool'], opt: 4, ret: T.bool, doc: 'begin(SSD1306_SWITCHCAPVCC, 0x3C)', run: (vm, a) => {
        const o = a[0] as { addr: number; w: number; h: number };
        o.addr = a.length > 2 ? n(a[2]) : 0x3c;
        if (o.w !== 128 || (o.h !== 64 && o.h !== 32)) H(vm).warn('oled-size', `Display declared as ${o.w}×${o.h}`, 'The simulated SSD1306 is 128 × 64.');
        return 1;
      } },
      display: { params: [], ret: T.void, doc: 'display() → send the buffer to the screen', run: (vm, a) => { const o = a[0] as { addr: number; buf: Uint8Array; inverted: boolean }; H(vm).oledShow(o.addr, o.inverted ? o.buf.map((v) => v ^ 1) : o.buf); } },
      clearDisplay: { params: [], ret: T.void, doc: 'clearDisplay()', run: (_vm, a) => { (a[0] as { buf: Uint8Array }).buf.fill(0); } },
      invertDisplay: { params: ['bool'], ret: T.void, doc: 'invertDisplay(bool)', run: (_vm, a) => { (a[0] as { inverted: boolean }).inverted = !!n(a[1]); } },
      dim: { params: ['bool'], ret: T.void, doc: 'dim(bool)', run: () => VOID },
    },
  },
  Adafruit_ST7735: {
    name: 'Adafruit_ST7735', header: 'Adafruit_ST7735.h',
    ctor: {
      params: ['int', 'int', 'int', 'int', 'int'], opt: 2, doc: 'Adafruit_ST7735 tft(CS, DC, RST); (hardware SPI: SCK 18, MOSI 23)',
      run: (a) => {
        const five = a.length === 5;
        const pins = { cs: n(a[0]), dc: n(a[1]), mosi: five ? n(a[2]) : 23, sck: five ? n(a[3]) : 18, rst: five ? n(a[4]) : n(a[2]) };
        const o = { cls: 'Adafruit_ST7735', pins, fb: null as ColorFramebuffer | null, gfx: null as unknown as Gfx, vm: null as VM | null };
        o.gfx = new Gfx(128, 160, (x, y, c) => {
          const fb = o.vm ? H(o.vm).tftTarget(o.pins) : null;
          if (fb) fb.px565(x, y, c);
        });
        return o;
      },
    },
    methods: { ...gfxMethods(), ...printSpecs((_vm, self, text) => (self as { gfx: Gfx }).gfx.write(text)),
      initR: { params: ['int'], opt: 1, ret: T.void, doc: 'initR(INITR_BLACKTAB)', run: (vm, a) => { const o = a[0] as { vm: VM; gfx: Gfx }; o.vm = vm; o.gfx.textColor = 0xffff; o.gfx.fillScreen(0); } },
      initB: { params: [], ret: T.void, doc: 'initB()', run: (vm, a) => { const o = a[0] as { vm: VM; gfx: Gfx }; o.vm = vm; o.gfx.fillScreen(0); } },
      color565: { params: ['int', 'int', 'int'], ret: { k: 'num', n: 'u16' }, doc: 'color565(r, g, b)', run: (_vm, a) => color565(n(a[1]), n(a[2]), n(a[3])) },
      invertDisplay: { params: ['bool'], ret: T.void, doc: 'invertDisplay(bool)', run: () => VOID },
    },
  },
  Adafruit_BME280: {
    name: 'Adafruit_BME280', header: 'Adafruit_BME280.h',
    ctor: { params: [], doc: 'Adafruit_BME280 bme;', run: () => ({ cls: 'Adafruit_BME280', addr: 0x77 }) },
    methods: {
      begin: { params: ['int', 'obj'], opt: 2, ret: T.bool, doc: 'begin(0x76) → true if found (default address 0x77)', run: (vm, a) => { const o = a[0] as { addr: number }; o.addr = a.length > 1 ? n(a[1]) : 0x77; return H(vm).bmeProbe(o.addr) ? 1 : 0; } },
      readTemperature: { params: [], ret: T.f32, doc: 'readTemperature() → °C', run: (vm, a) => H(vm).bmeRead((a[0] as { addr: number }).addr)?.temperature ?? NaN },
      readHumidity: { params: [], ret: T.f32, doc: 'readHumidity() → %RH', run: (vm, a) => H(vm).bmeRead((a[0] as { addr: number }).addr)?.humidity ?? NaN },
      readPressure: { params: [], ret: T.f32, doc: 'readPressure() → Pa', run: (vm, a) => { const r = H(vm).bmeRead((a[0] as { addr: number }).addr); return r ? r.pressure * 100 : NaN; } },
      readAltitude: { params: ['num'], ret: T.f32, doc: 'readAltitude(seaLevel_hPa) → m', run: (vm, a) => { const r = H(vm).bmeRead((a[0] as { addr: number }).addr); return r ? 44330 * (1 - Math.pow(r.pressure / n(a[1]), 0.1903)) : NaN; } },
    },
  },
  DHT: {
    name: 'DHT', header: 'DHT.h',
    ctor: { params: ['int', 'int'], doc: 'DHT dht(pin, DHT22);', run: (a) => ({ cls: 'DHT', pin: n(a[0]), model: n(a[1]) }) },
    methods: {
      begin: { params: ['int'], opt: 1, ret: T.void, doc: 'begin()', run: (vm, a) => { const o = a[0] as { pin: number }; H(vm).pinMode(o.pin, 0x05); } },
      readTemperature: { params: ['bool'], opt: 1, ret: T.f32, doc: 'readTemperature([fahrenheit]) → °C or NaN', run: (vm, a) => { const o = a[0] as { pin: number; model: number }; const r = H(vm).dhtRead(o.pin, o.model); if (!r) return NaN; return a.length > 1 && n(a[1]) ? r.temperature * 1.8 + 32 : r.temperature; } },
      readHumidity: { params: [], ret: T.f32, doc: 'readHumidity() → %RH or NaN', run: (vm, a) => { const o = a[0] as { pin: number; model: number }; return H(vm).dhtRead(o.pin, o.model)?.humidity ?? NaN; } },
    },
  },
  Servo: {
    name: 'Servo', header: 'ESP32Servo.h',
    ctor: { params: [], doc: 'Servo myServo;', run: () => ({ cls: 'Servo', pin: -1, min: 544, max: 2400, us: 1472 }) },
    methods: {
      attach: { params: ['int', 'int', 'int'], opt: 2, ret: T.i32, doc: 'attach(pin[, minUs, maxUs])', run: (_vm, a) => { const o = a[0] as { pin: number; min: number; max: number }; o.pin = n(a[1]); if (a.length > 3) { o.min = n(a[2]); o.max = n(a[3]); } return 0; } },
      write: { params: ['num'], ret: T.void, doc: 'write(angle 0…180)', run: (vm, a) => {
        const o = a[0] as { pin: number; min: number; max: number; us: number };
        if (o.pin < 0) return new Fault('Servo.write() before attach(pin).');
        let v = n(a[1]);
        // like the Arduino Servo library, values ≥ 544 are treated as microseconds
        if (v < 544) { v = Math.max(0, Math.min(180, v)); o.us = o.min + (v / 180) * (o.max - o.min); } else o.us = v;
        H(vm).servoUs(o.pin, o.us);
        return VOID;
      } },
      writeMicroseconds: { params: ['num'], ret: T.void, doc: 'writeMicroseconds(us)', run: (vm, a) => { const o = a[0] as { pin: number; us: number }; if (o.pin < 0) return new Fault('Servo.writeMicroseconds() before attach(pin).'); o.us = n(a[1]); H(vm).servoUs(o.pin, o.us); return VOID; } },
      read: { params: [], ret: T.i32, doc: 'read() → last angle written', run: (_vm, a) => { const o = a[0] as { min: number; max: number; us: number }; return Math.round(((o.us - o.min) / (o.max - o.min)) * 180); } },
      attached: { params: [], ret: T.bool, doc: 'attached()', run: (_vm, a) => ((a[0] as { pin: number }).pin >= 0 ? 1 : 0) },
      detach: { params: [], ret: T.void, doc: 'detach()', run: (vm, a) => { const o = a[0] as { pin: number }; if (o.pin >= 0) H(vm).pwm(o.pin, 0, 0); o.pin = -1; } },
      setPeriodHertz: { params: ['int'], ret: T.void, doc: 'setPeriodHertz(50)', run: (vm, a) => { if (n(a[1]) !== 50) H(vm).warn('servo-hz', 'Servo period is not 50 Hz', 'Hobby servos expect a 50 Hz pulse; the simulator assumes 50 Hz.'); } },
    },
  },
};

/** Static functions called as Class::name(). */
export const STATICS: Record<string, NativeSpec> = {
  'ESP32PWM::allocateTimer': { params: ['int'], ret: T.void, doc: 'ESP32PWM::allocateTimer(n)', run: () => VOID },
};

/** Objects that exist without being declared. */
export const GLOBAL_OBJECTS: Record<string, { cls: string; header: string }> = {
  Serial: { cls: 'HardwareSerial', header: 'Arduino.h' },
  Wire: { cls: 'TwoWire', header: 'Wire.h' },
  ESP: { cls: 'EspClass', header: 'Arduino.h' },
};

function gfxMethods(): Record<string, NativeSpec> {
  const g = (a: unknown[]) => (a[0] as { gfx: Gfx }).gfx;
  const ink = (a: unknown[], i: number) => (a.length > i ? n(a[i]) : 1);
  return {
    setTextSize: { params: ['int', 'int'], opt: 1, ret: T.void, doc: 'setTextSize(size)', run: (_vm, a) => { g(a).textSize = Math.max(1, n(a[1])); } },
    setTextColor: { params: ['int', 'int'], opt: 1, ret: T.void, doc: 'setTextColor(color[, background])', run: (_vm, a) => { g(a).textColor = n(a[1]); g(a).textBg = a.length > 2 ? n(a[2]) : null; } },
    setCursor: { params: ['int', 'int'], ret: T.void, doc: 'setCursor(x, y)', run: (_vm, a) => { g(a).cursorX = n(a[1]); g(a).cursorY = n(a[2]); } },
    getCursorX: { params: [], ret: T.i32, doc: 'getCursorX()', run: (_vm, a) => g(a).cursorX },
    getCursorY: { params: [], ret: T.i32, doc: 'getCursorY()', run: (_vm, a) => g(a).cursorY },
    setTextWrap: { params: ['bool'], ret: T.void, doc: 'setTextWrap(bool)', run: (_vm, a) => { g(a).wrap = !!n(a[1]); } },
    setRotation: { params: ['int'], ret: T.void, doc: 'setRotation(0…3)', run: (_vm, a) => { g(a).rotation = n(a[1]) & 3; } },
    cp437: { params: ['bool'], opt: 1, ret: T.void, doc: 'cp437(true)', run: (_vm, a) => { g(a).cp437 = a.length > 1 ? !!n(a[1]) : true; } },
    width: { params: [], ret: T.i32, doc: 'width()', run: (_vm, a) => g(a).width },
    height: { params: [], ret: T.i32, doc: 'height()', run: (_vm, a) => g(a).height },
    fillScreen: { params: ['int'], ret: T.void, doc: 'fillScreen(color)', run: (_vm, a) => g(a).fillScreen(n(a[1])) },
    drawPixel: { params: ['int', 'int', 'int'], ret: T.void, doc: 'drawPixel(x, y, color)', run: (_vm, a) => g(a).pixel(n(a[1]), n(a[2]), n(a[3])) },
    drawLine: { params: ['int', 'int', 'int', 'int', 'int'], ret: T.void, doc: 'drawLine(x0, y0, x1, y1, color)', run: (_vm, a) => g(a).line(n(a[1]), n(a[2]), n(a[3]), n(a[4]), n(a[5])) },
    drawFastHLine: { params: ['int', 'int', 'int', 'int'], ret: T.void, doc: 'drawFastHLine(x, y, w, color)', run: (_vm, a) => g(a).hline(n(a[1]), n(a[2]), n(a[3]), n(a[4])) },
    drawFastVLine: { params: ['int', 'int', 'int', 'int'], ret: T.void, doc: 'drawFastVLine(x, y, h, color)', run: (_vm, a) => g(a).vline(n(a[1]), n(a[2]), n(a[3]), n(a[4])) },
    drawRect: { params: ['int', 'int', 'int', 'int', 'int'], ret: T.void, doc: 'drawRect(x, y, w, h, color)', run: (_vm, a) => g(a).rect(n(a[1]), n(a[2]), n(a[3]), n(a[4]), ink(a, 5)) },
    fillRect: { params: ['int', 'int', 'int', 'int', 'int'], ret: T.void, doc: 'fillRect(x, y, w, h, color)', run: (_vm, a) => g(a).fillRect(n(a[1]), n(a[2]), n(a[3]), n(a[4]), ink(a, 5)) },
    drawRoundRect: { params: ['int', 'int', 'int', 'int', 'int', 'int'], ret: T.void, doc: 'drawRoundRect(x, y, w, h, r, color)', run: (_vm, a) => g(a).roundRect(n(a[1]), n(a[2]), n(a[3]), n(a[4]), n(a[5]), n(a[6]), false) },
    fillRoundRect: { params: ['int', 'int', 'int', 'int', 'int', 'int'], ret: T.void, doc: 'fillRoundRect(x, y, w, h, r, color)', run: (_vm, a) => g(a).roundRect(n(a[1]), n(a[2]), n(a[3]), n(a[4]), n(a[5]), n(a[6]), true) },
    drawCircle: { params: ['int', 'int', 'int', 'int'], ret: T.void, doc: 'drawCircle(x, y, r, color)', run: (_vm, a) => g(a).circle(n(a[1]), n(a[2]), n(a[3]), n(a[4]), false) },
    fillCircle: { params: ['int', 'int', 'int', 'int'], ret: T.void, doc: 'fillCircle(x, y, r, color)', run: (_vm, a) => g(a).circle(n(a[1]), n(a[2]), n(a[3]), n(a[4]), true) },
    drawTriangle: { params: ['int', 'int', 'int', 'int', 'int', 'int', 'int'], ret: T.void, doc: 'drawTriangle(x0, y0, x1, y1, x2, y2, color)', run: (_vm, a) => g(a).triangle(n(a[1]), n(a[2]), n(a[3]), n(a[4]), n(a[5]), n(a[6]), n(a[7]), false) },
    fillTriangle: { params: ['int', 'int', 'int', 'int', 'int', 'int', 'int'], ret: T.void, doc: 'fillTriangle(x0, y0, x1, y1, x2, y2, color)', run: (_vm, a) => g(a).triangle(n(a[1]), n(a[2]), n(a[3]), n(a[4]), n(a[5]), n(a[6]), n(a[7]), true) },
    drawBitmap: {
      params: ['int', 'int', 'arr', 'int', 'int', 'int', 'int'], opt: 1, ret: T.void, doc: 'drawBitmap(x, y, bitmap[], w, h, color[, background]) (1 bit per pixel, MSB first)',
      run: (_vm, a) => {
        const [x, y] = [n(a[1]), n(a[2])], bmp = a[3] as number[], w = n(a[4]), h = n(a[5]), fg = n(a[6]), bg = a.length > 7 ? n(a[7]) : null;
        const row = (w + 7) >> 3;
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          const on = ((bmp[j * row + (i >> 3)] ?? 0) << (i & 7)) & 0x80;
          if (on) g(a).pixel(x + i, y + j, fg); else if (bg != null) g(a).pixel(x + i, y + j, bg);
        }
      },
    },
    drawRGBBitmap: {
      params: ['int', 'int', 'arr', 'arrnum', 'int', 'int'], opt: 1, ret: T.void, doc: 'drawRGBBitmap(x, y, rgb565[], [mask[],] w, h)',
      run: (_vm, a) => {
        const masked = a.length === 7;
        const [x, y] = [n(a[1]), n(a[2])], px = a[3] as number[], mask = masked ? (a[4] as number[]) : null;
        const w = n(a[masked ? 5 : 4]), h = n(a[masked ? 6 : 5]);
        if (!masked && Array.isArray(a[4])) return new Fault('drawRGBBitmap(x, y, bitmap, mask, w, h) needs 6 arguments.');
        const row = (w + 7) >> 3;
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          if (mask && !((((mask[j * row + (i >> 3)] ?? 0) << (i & 7)) & 0x80))) continue;
          g(a).pixel(x + i, y + j, px[j * w + i] ?? 0);
        }
        return VOID;
      },
    },
  };
}

function parseNumber(vm: VM, float: boolean) {
  let s = '';
  // skip anything before the number, then read digits (Stream::parseInt semantics, no timeout)
  for (let c = H(vm).serialPeek(); c >= 0 && !/[-\d.]/.test(String.fromCharCode(c)); c = H(vm).serialPeek()) H(vm).serialRead();
  for (let c = H(vm).serialPeek(); c >= 0 && /[-\d.]/.test(String.fromCharCode(c)) && (float || c !== 46); c = H(vm).serialPeek()) { s += String.fromCharCode(c); H(vm).serialRead(); }
  const v = float ? parseFloat(s) : parseInt(s, 10);
  return Number.isNaN(v) ? 0 : v;
}

/** Everything the editor can offer as completions. */
export function completionEntries(): { label: string; detail: string; kind: 'function' | 'constant' | 'class' | 'method' | 'object' }[] {
  const out: { label: string; detail: string; kind: 'function' | 'constant' | 'class' | 'method' | 'object' }[] = [];
  for (const [k, v] of Object.entries(FUNCTIONS)) out.push({ label: k, detail: v.doc, kind: 'function' });
  for (const k of Object.keys(CONSTANTS)) out.push({ label: k, detail: 'constant', kind: 'constant' });
  for (const [k, v] of Object.entries(CLASSES)) if (!['HardwareSerial', 'TwoWire', 'EspClass'].includes(k)) out.push({ label: k, detail: v.ctor.doc, kind: 'class' });
  for (const k of Object.keys(GLOBAL_OBJECTS)) out.push({ label: k, detail: CLASSES[GLOBAL_OBJECTS[k].cls].name, kind: 'object' });
  return out;
}

export type { Kind };
