/*
  Runs a compiled sketch against the engine.

  The sketch executes in slices scheduled on the engine's virtual clock. Each bytecode instruction costs OP_MS of
  simulated time, so a busy loop still moves time forward; delay() ends the slice and schedules the next one when the
  delay is over. Natives see a time cursor (slice start + instructions so far), so millis() advances inside a slice and
  pin changes land in the signal history at the instant the sketch made them.

  Interrupts: attachInterrupt() pins are watched every time the circuit settles; a matching edge runs the handler on
  its own short-lived thread (sharing the globals), even while the main thread is inside delay().
*/
import type { ColorFramebuffer } from '../devices/colorFramebuffer';
import type { PinMode } from '../program/types';
import { type FwHost } from './runtime';
import { Thread, VM, type Compiled, type RunResult } from './vm';

/** Simulated time per bytecode instruction (≈ 24 CPU cycles at 240 MHz). */
export const OP_MS = 1e-4;
/** Instructions per slice: 2 ms of simulated time. */
export const SLICE_OPS = 20_000;
/** An interrupt handler that runs longer than this trips the interrupt watchdog (300 ms on the real chip). */
const ISR_OPS = 3_000_000;

/** What the runner needs from the engine (implemented by Engine). */
export interface FirmwareTarget {
  readonly clockNow: number;
  millis(): number;
  schedule(at: number, fn: () => void): { cancel(): void };
  setCursor(fn: (() => number) | null): void;
  pinMode(pin: number, mode: PinMode): void;
  digitalWrite(pin: number, level: 0 | 1): void;
  digitalRead(pin: number): 0 | 1;
  /** Logic level without side effects (null = floating), for interrupt edge detection. */
  pinLevel(pin: number): 0 | 1 | null;
  analogRead(pin: number): number;
  pinVolts(pin: number): number;
  pwmWrite(pin: number, duty: number, hz: number): void;
  tone(pin: number, hz: number, ms: number): void;
  noTone(pin: number): void;
  servoPulse(pin: number, us: number): void;
  serialOut(text: string): void;
  random(): number;
  reseed(seed: number): void;
  setI2cPins(sda: number, scl: number): void;
  i2cAck(addr: number): boolean;
  oledShow(addr: number, pixels: Uint8Array): void;
  bmeAt(addr: number, probeOnly: boolean): { temperature: number; humidity: number; pressure: number } | null;
  dhtAt(pin: number, model: number): { temperature: number; humidity: number } | null;
  tftFor(pins: { cs: number; dc: number; rst: number; mosi: number; sck: number }): ColorFramebuffer | null;
  warn(code: string, title: string, detail: string, fix?: string): void;
  firmwareFault(message: string, line: number): void;
  firmwareRestart(): void;
}

const MODES: Record<number, PinMode> = { 0x01: 'INPUT', 0x03: 'OUTPUT', 0x05: 'INPUT_PULLUP', 0x09: 'INPUT_PULLDOWN', 0x13: 'OUTPUT' };

export class FirmwareRunner implements FwHost {
  readonly vm: VM;
  /** Arduino-ESP32 sketches have no named variables to show; kept for the engine's runner interface. */
  vars = new Map<string, number>();
  /** Source line the main thread is at (the line of the delay() it is sleeping in, say). */
  line = 0;
  private main: Thread;
  private timer: { cancel(): void } | null = null;
  private running = false;
  private sliceStart = 0;
  private inSlice = false;
  private serialStarted = false;
  private rx: number[] = [];
  private isrs = new Map<number, { fn: number; mode: number; last: 0 | 1 | null }>();
  private inIsr = false;
  private pendingIsr: number[] = [];
  private tftCache = new Map<string, ColorFramebuffer | null>();
  private touched = new Set<ColorFramebuffer>();

  constructor(prog: Compiled, private target: FirmwareTarget) {
    this.vm = new VM(prog);
    this.vm.host = this;
    this.main = this.vm.mainThread();
  }

  start() {
    this.running = true;
    this.timer = this.target.schedule(this.target.clockNow, () => this.slice());
  }

  stop() {
    this.running = false;
    this.timer?.cancel();
    this.timer = null;
    this.target.setCursor(null);
  }

  get isRunning() { return this.running; }

  private slice() {
    this.timer = null;
    if (!this.running) return;
    this.sliceStart = this.target.clockNow;
    this.inSlice = true;
    this.target.setCursor(() => this.now());
    let r: RunResult;
    try {
      r = this.vm.run(this.main, SLICE_OPS);
    } finally {
      this.inSlice = false;
      this.target.setCursor(null);
      this.flushDisplays();
    }
    this.line = this.vm.lineOf(this.main);
    if (!this.running) return;
    const elapsed = r.used * OP_MS;
    switch (r.kind) {
      case 'budget': this.timer = this.target.schedule(this.sliceStart + elapsed, () => this.slice()); break;
      case 'sleep': this.timer = this.target.schedule(this.sliceStart + elapsed + r.ms, () => this.slice()); break;
      case 'done': this.running = false; break;
      case 'fault': this.line = r.line; this.running = false; this.target.firmwareFault(r.message, r.line); break;
      case 'restart': this.running = false; this.target.firmwareRestart(); break;
    }
  }

  /** Simulated time at the instruction being executed. */
  private now() {
    return this.inSlice ? this.sliceStart + this.vm.used * OP_MS : this.target.clockNow;
  }

  /** Called whenever the circuit settles: runs interrupt handlers for edges on attached pins. */
  onInputsChanged() {
    if (!this.running || !this.isrs.size) return;
    for (const [pin, isr] of this.isrs) {
      const now = this.target.pinLevel(pin);
      const before = isr.last;
      isr.last = now;
      if (now == null || before == null || now === before) continue;
      const rising = now === 1;
      const fire = isr.mode === 3 || (isr.mode === 1 && rising) || (isr.mode === 2 && !rising) || (isr.mode === 5 && rising) || (isr.mode === 4 && !rising);
      if (fire) this.pendingIsr.push(isr.fn);
    }
    if (this.inIsr) return;
    this.inIsr = true;
    try {
      while (this.pendingIsr.length && this.running) {
        const fn = this.pendingIsr.shift()!;
        const t = this.vm.callThread(fn);
        const r = this.vm.run(t, ISR_OPS);
        if (r.kind === 'fault') { this.running = false; this.timer?.cancel(); this.target.firmwareFault(r.message, r.line); return; }
        if (r.kind === 'budget') {
          this.running = false; this.timer?.cancel();
          this.target.firmwareFault(`Interrupt watchdog timeout: ${this.vm.prog.funcs[fn].name}() ran for more than 300 ms. Keep interrupt handlers short (set a flag and handle it in loop()).`, this.vm.lineOf(t));
          return;
        }
        if (r.kind === 'restart') { this.running = false; this.timer?.cancel(); this.target.firmwareRestart(); return; }
      }
    } finally {
      this.inIsr = false;
      if (!this.inSlice) this.flushDisplays();
    }
  }

  serialInput(text: string) {
    for (const ch of text) this.rx.push(ch.charCodeAt(0) & 0xff);
    if (this.rx.length > 256) this.rx.splice(0, this.rx.length - 256);
  }

  private flushDisplays() {
    for (const fb of this.touched) fb.commit();
    this.touched.clear();
    this.tftCache.clear();
  }

  /* ---------------- FwHost ---------------- */

  millis() { return Math.floor(this.target.millis() + (this.now() - this.target.clockNow)); }
  micros() { return Math.floor((this.target.millis() + (this.now() - this.target.clockNow)) * 1000); }

  pinMode(pin: number, mode: number) {
    const m = MODES[mode];
    if (!m) { this.warn('bad-pin-mode', `pinMode(${pin}, ${mode}): unknown mode`, 'Use INPUT, OUTPUT, INPUT_PULLUP or INPUT_PULLDOWN.'); return; }
    if (mode === 0x13) this.warn('open-drain', 'OUTPUT_OPEN_DRAIN is simulated as a normal OUTPUT', 'The simulated pin drives both HIGH and LOW.');
    this.target.pinMode(pin, m);
    const isr = this.isrs.get(pin);
    if (isr) isr.last = this.target.pinLevel(pin);
  }

  digitalWrite(pin: number, v: number) { this.target.digitalWrite(pin, v ? 1 : 0); }
  digitalRead(pin: number) { return this.target.digitalRead(pin); }

  analogRead(pin: number, bits: number) {
    const raw = this.target.analogRead(pin);
    return bits === 12 ? raw : Math.round((raw / 4095) * ((1 << bits) - 1));
  }

  analogReadMilliVolts(pin: number) {
    this.target.analogRead(pin); // same checks (ADC pin, floating) as analogRead
    return Math.round(this.target.pinVolts(pin) * 1000);
  }

  pwm(pin: number, duty: number, freq: number) { this.target.pwmWrite(pin, duty, freq); }
  tone(pin: number, hz: number, ms: number) { this.target.tone(pin, hz, ms); }
  noTone(pin: number) { this.target.noTone(pin); }
  servoUs(pin: number, us: number) { this.target.servoPulse(pin, us); }

  serialBegin() { this.serialStarted = true; }
  serialWrite(text: string) {
    if (!this.serialStarted) {
      this.warn('serial-not-started', 'Serial.print before Serial.begin()', 'Nothing is sent until Serial.begin(115200) runs in setup(), so the monitor stays empty.', 'Add Serial.begin(115200); at the start of setup().');
      return;
    }
    this.target.serialOut(text);
  }
  serialAvailable() { return this.rx.length; }
  serialRead() { return this.rx.length ? this.rx.shift()! : -1; }
  serialPeek() { return this.rx.length ? this.rx[0] : -1; }

  random() { return this.target.random(); }
  reseed(seed: number) { this.target.reseed(seed); }

  attachInterrupt(pin: number, fn: number, mode: number) {
    if (![1, 2, 3, 4, 5].includes(mode)) { this.warn('bad-isr-mode', `attachInterrupt mode ${mode} is not supported`, 'Use RISING, FALLING or CHANGE.'); return; }
    this.isrs.set(pin, { fn, mode, last: this.target.pinLevel(pin) });
  }
  detachInterrupt(pin: number) { this.isrs.delete(pin); }

  wireBegin(sda: number, scl: number) { this.target.setI2cPins(sda, scl); }
  i2cProbe(addr: number) { return this.target.i2cAck(addr); }
  oledShow(addr: number, pixels: Uint8Array) { this.target.oledShow(addr, pixels); }
  bmeProbe(addr: number) { return this.target.bmeAt(addr, true) != null; }
  bmeRead(addr: number) { return this.target.bmeAt(addr, false); }
  dhtRead(pin: number, model: number) { return this.target.dhtAt(pin, model); }

  tftTarget(pins: { cs: number; dc: number; rst: number; mosi: number; sck: number }) {
    const key = `${pins.cs},${pins.dc},${pins.rst},${pins.mosi},${pins.sck}`;
    let fb = this.tftCache.get(key);
    if (fb === undefined) { fb = this.target.tftFor(pins); this.tftCache.set(key, fb); }
    if (fb) this.touched.add(fb);
    return fb;
  }

  restart() { /* handled through the Restart result of the VM */ }
  warn(code: string, title: string, detail: string, fix?: string) { this.target.warn(code, title, detail, fix); }
}
