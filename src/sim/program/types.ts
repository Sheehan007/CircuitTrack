/*
  The behaviour program: a structured stand-in for firmware.

  It is deliberately shaped like an Arduino sketch (pin modes and device set-up, then event rules) so that it can be
  turned into Arduino-ESP32 code (see codegen.ts) and, later, replaced by real user code running against the same HAL.
  Programs only know about GPIO numbers and device bindings, like firmware does; they never reach into the circuit.
*/

export type PinMode = 'OUTPUT' | 'INPUT' | 'INPUT_PULLUP' | 'INPUT_PULLDOWN';

export type DeviceBinding =
  | { id: string; kind: 'dht'; part: string; model: 'DHT22' | 'DHT11'; pin: number }
  | { id: string; kind: 'ssd1306'; part: string; address: number }
  | { id: string; kind: 'bme280'; part: string; address: number }
  /** ST7735 on hardware SPI (SCK = GPIO18, MOSI = GPIO23); rst = -1 means RESET is tied to 3V3. */
  | { id: string; kind: 'tft'; part: string; cs: number; dc: number; rst: number };

export type Value =
  | { kind: 'num'; value: number }
  | { kind: 'var'; name: string }
  | { kind: 'digitalRead'; pin: number }
  | { kind: 'analogRead'; pin: number }
  | { kind: 'millis' }
  /** Seeded random integer in [min, max]. */
  | { kind: 'random'; min: number; max: number }
  /** Data feed value (simulated offline, see feeds.ts). */
  | { kind: 'feed'; feed: string }
  /** Number of lines in a text list. */
  | { kind: 'listLen'; list: string }
  /** Arduino map(): rescale a value from one range to another (integer maths, like the real function). */
  | { kind: 'map'; value: Value; inMin: number; inMax: number; outMin: number; outMax: number };

export type Trigger =
  | { kind: 'start' }
  | { kind: 'every'; ms: number; immediate?: boolean }
  | { kind: 'pinEdge'; pin: number; edge: 'rising' | 'falling' | 'change' };

export type CompareOp = '==' | '!=' | '<' | '<=' | '>' | '>=';

export interface Condition {
  left: Value;
  op: CompareOp;
  right: Value;
}

export type ActionBody =
  | { kind: 'digitalWrite'; pin: number; value: 'HIGH' | 'LOW' | 'TOGGLE' }
  | { kind: 'pwmWrite'; pin: number; duty: Value }
  | { kind: 'setVar'; name: string; value: Value; op: 'set' | 'add' }
  | { kind: 'readDht'; device: string; temp: string; hum: string }
  | { kind: 'oledClear'; device: string }
  | { kind: 'oledText'; device: string; x: number; y: number; size: number; text: string }
  | { kind: 'serialPrint'; text: string }
  | { kind: 'servoWrite'; pin: number; angle: Value }
  | { kind: 'tone'; pin: number; freq: Value; ms: number }
  | { kind: 'noTone'; pin: number }
  | { kind: 'readBme'; device: string; temp: string; hum: string; pres: string }
  | { kind: 'tftFill'; device: string; color: string }
  | { kind: 'tftText'; device: string; x: number; y: number; size: number; color: string; text: string }
  | { kind: 'tftRect'; device: string; x: number; y: number; w: number; h: number; color: string; fill: boolean }
  | { kind: 'tftCircle'; device: string; x: number; y: number; r: number; color: string; fill: boolean }
  | { kind: 'tftSprite'; device: string; sprite: string; x: number; y: number; scale: number }
  | { kind: 'tftBar'; device: string; x: number; y: number; w: number; h: number; value: Value; max: number; color: string };

export type Action = { id: string } & ActionBody;

export type ActionKind = Action['kind'];

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  /** All must hold (AND). Empty = always. */
  conditions: Condition[];
  actions: Action[];
  elseActions: Action[];
}

export interface Program {
  pins: Record<number, PinMode>;
  i2c: { sda: number; scl: number };
  devices: DeviceBinding[];
  vars: { name: string; initial: number }[];
  /** Text lists (e.g. lyrics): "{lyrics[i]}" in any text prints line i (wrapping round). */
  lists?: Record<string, string[]>;
  /** Pixel images for the TFT (e.g. uploaded): rows of "#rrggbb" ("" = transparent). */
  sprites?: Record<string, { w: number; h: number; px: string[] }>;
  rules: Rule[];
}

export const emptyProgram = (): Program => ({
  pins: {},
  i2c: { sda: 21, scl: 22 },
  devices: [],
  vars: [],
  lists: {},
  sprites: {},
  rules: [],
});
