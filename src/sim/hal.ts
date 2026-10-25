import type { DeviceBinding, PinMode } from './program/types';
import type { MonoFramebuffer } from './devices/framebuffer';
import type { ColorFramebuffer } from './devices/colorFramebuffer';
import type { Issue } from './types';

export type DhtResult = { ok: true; temperature: number; humidity: number } | { ok: false; reason: string };
export type DeviceResult = { ok: true } | { ok: false; reason: string };
export type BmeResult = { ok: true; temperature: number; humidity: number; pressure: number } | { ok: false; reason: string };

/**
 * The virtual hardware the behaviour program (and, later, real user code) talks to. It mirrors the Arduino-ESP32 calls
 * a sketch would make; the engine implements it on top of the circuit solver.
 */
export interface Hal {
  now(): number;
  millis(): number;
  pinMode(pin: number, mode: PinMode): void;
  digitalWrite(pin: number, level: 0 | 1): void;
  /** Last level written by this program (for TOGGLE), not a read of the wire. */
  outputLevel(pin: number): 0 | 1;
  digitalRead(pin: number): 0 | 1;
  analogRead(pin: number): number;
  analogWrite(pin: number, duty: number): void;
  serialPrintln(text: string): void;
  dhtRead(binding: Extract<DeviceBinding, { kind: 'dht' }>): DhtResult;
  oledDraw(binding: Extract<DeviceBinding, { kind: 'ssd1306' }>, draw: (fb: MonoFramebuffer) => void): DeviceResult;
  /** ESP32Servo: attach + write(angle) → a 50 Hz pulse of 544–2400 µs on the pin. */
  servoWrite(pin: number, angle: number): void;
  /** Arduino-ESP32 tone(): a 50 % square wave; ms = 0 plays until noTone(). */
  tone(pin: number, hz: number, ms: number): void;
  noTone(pin: number): void;
  bmeRead(binding: Extract<DeviceBinding, { kind: 'bme280' }>): BmeResult;
  tftDraw(binding: Extract<DeviceBinding, { kind: 'tft' }>, draw: (fb: ColorFramebuffer) => void): DeviceResult;
  /** Seeded random number in [0, 1). */
  random(): number;
  /** Data feed value at the current virtual time. */
  feed(id: string): number;
  schedule(at: number, fn: () => void): { cancel(): void };
  /** Report a problem found while running (deduplicated by code + parts). */
  note(issue: Issue): void;
  /** For code highlighting: which action just ran. */
  markActive(ruleId: string, actionId?: string): void;
}
