/*
  Simulation engine: owns the virtual clock, the HAL, the circuit solution, the device models and what runs on the
  board: either a compiled sketch (code mode, see firmware/) or a behaviour program (rules mode).

  Lifecycle (what the UI's controls map to):
    idle      the board is powered over USB but no sketch is running: every GPIO is a high-impedance input
    running   Run boots the uploaded sketch (or the behaviour program) and the clock advances when the host calls advance()
    crashed   the sketch hit a runtime fault (division by zero, array out of bounds, …); it stays stopped at that line
    paused    the host simply stops calling advance(); state is frozen
    reset()   back to idle at t = 0 with the same project — deterministic for a given seed and the same inputs

  Every change (a wire, a param, a button press, a pin write) marks the circuit dirty; it is re-solved lazily before
  anything reads it. Parts with continuous behaviour (servos, motors, PIR timers) advance on a fixed physics tick
  scheduled on the same clock. Simulated behaviour is not firmware: see the README for what is and isn't modelled.
*/
import { VirtualClock, rng } from './clock';
import { getDef } from './components/registry';
import type { ComponentDef, ElectricalCtx } from './components/types';
import { DOIT_DEVKIT_V1 } from './boards/doitDevkitV1';
import type { BoardProfile, PinDef } from './boards/types';
import { MonoFramebuffer } from './devices/framebuffer';
import { ColorFramebuffer } from './devices/colorFramebuffer';
import { MODELS, TICK_MS, type DeviceHost } from './devices/models';
import type { BmeResult, DhtResult, DeviceResult, Hal } from './hal';
import { buildNetlist, type Netlist } from './netlist';
import { ProgramRunner } from './program/runner';
import { emptyProgram, type DeviceBinding, type PinMode } from './program/types';
import { FirmwareRunner, type FirmwareTarget } from './firmware/runner';
import type { Compiled } from './firmware/vm';
import { BOARD_PART_ID, type Project } from './project';
import { drivenNodes, solve, type Element, type Solution } from './solver';
import { termKey, type Issue, type PartInstance, type SerialLine } from './types';
import { electricalChecks, staticChecks } from './checks';
import { getFeed } from './feeds';

export type Firmware = 'none' | 'running' | 'reset-held' | 'download' | 'boot-failed' | 'crashed';

/** What drives the board: a compiled Arduino sketch, or the visual behaviour rules. */
export type RunMode = 'code' | 'rules';

export interface FirmwareInfo {
  mode: RunMode;
  /** Source of the sketch the board is running (code mode), to tell the editor it was changed since. */
  uploaded: string | null;
  /** Line the sketch is executing (or sleeping in), for the editor. */
  line: number | null;
  fault: { message: string; line: number } | null;
  /** False when the simulation could not keep up with real time on the last frame. */
  realtime: boolean;
}

/**
 * Electrical state of a net, for the Wiring view. "driven" = a source (GPIO output, supply, or a path through parts to
 * one) defines its voltage; "pulled" = only a pull resistor does; "high-z" = a GPIO input listens but nothing drives
 * it (the level is undefined); "floating" = nothing drives it and nothing reads it; "unknown" = no solution.
 */
export type NetState = 'power' | 'ground' | 'gpio-high' | 'gpio-low' | 'gpio-pwm' | 'driven' | 'pulled-up' | 'pulled-down' | 'high-z' | 'floating' | 'unknown';
export interface NetInfo { index: number; name: string; volts: number | null; state: NetState }

export interface PinRuntime {
  mode: PinMode | 'UNSET';
  level: 0 | 1;
  /** analogWrite duty 0–255 while PWM is active. */
  pwm: number | null;
  /** Peripheral function claimed by the program, e.g. "I²C SDA". */
  fn?: string;
  /** Servo pulse width (µs) while the pin drives a servo. */
  servoUs?: number | null;
  /** tone() frequency while a tone plays. */
  toneHz?: number | null;
  /** PWM (LEDC) frequency while PWM is active. */
  pwmHz?: number | null;
}

export interface PinSnapshot extends PinRuntime {
  id: string;
  gpio?: number;
  volts: number;
  /** What digitalRead would return; null if the pin is floating. */
  read: 0 | 1 | null;
  floating: boolean;
  /** Current out of the pin in mA (positive = sourcing). */
  ma: number;
  net: number;
}

export interface PartSnapshot {
  id: string;
  powered?: boolean;
  supplyV?: number;
  /** Values for the inspector, already formatted. */
  readings: [string, string][];
  /** State for the illustration. */
  visual: Record<string, unknown>;
}

export interface Snapshot {
  t: number;
  firmware: Firmware;
  bootedAt: number | null;
  pins: Record<string, PinSnapshot>;
  parts: Record<string, PartSnapshot>;
  board: { powered: boolean; led2: number; enDown: boolean; bootDown: boolean };
  serial: SerialLine[];
  issues: Issue[];
  netNames: string[];
  netVolts: number[];
  vars: Record<string, number>;
  active: { ruleId: string; actionId?: string; t: number } | null;
  fw: FirmwareInfo;
  nets: NetInfo[];
  version: number;
}

export interface HistoryPoint { t: number; v: number }

const VIH = 0.75 * 3.3, VIL = 0.25 * 3.3;
const SERIAL_MAX = 400;
const HISTORY_MAX = 4000;
const SERVO_US = [544, 2400];

export class Engine implements Hal {
  readonly board: BoardProfile;
  project!: Project;
  netlist!: Netlist;
  readonly clock = new VirtualClock();
  firmware: Firmware = 'none';
  bootedAt: number | null = null;
  serial: SerialLine[] = [];
  history = new Map<number, HistoryPoint[]>();
  inputs = new Map<string, Record<string, unknown>>();
  /** Runtime state of every part's device model (framebuffers, servo angle, …). */
  readonly states = new Map<string, any>();

  private pins = new Map<number, PinRuntime>();
  private runner: ProgramRunner | FirmwareRunner | null = null;
  /** The sketch last uploaded with Run (code mode); reboots (EN, ESP.restart) run it again. */
  private uploaded: { source: string; program: Compiled } | null = null;
  private fault: FirmwareInfo['fault'] = null;
  /** While a sketch slice runs: the simulated time of the instruction being executed. */
  private cursor: (() => number) | null = null;
  /** I²C pins chosen by the sketch (Wire.begin); null in rules mode. */
  private i2cOverride: { sda: number; scl: number } | null = null;
  /** Pin functions the sketch has claimed (I²C, SPI, DHT data) for the GPIO view. */
  private fwFns = new Map<number, string>();
  private openLine: SerialLine | null = null;
  private realtime = true;
  private readonly fwTarget: FirmwareTarget;
  private rand: () => number;
  private runtimeIssues = new Map<string, Issue>();
  private dirty = true;
  private sol!: CombinedSolution;
  private nodeCount = 0;
  private internalNodes = new Map<string, number>();
  private floatingSample = new Map<number, 0 | 1>();
  private active: Snapshot['active'] = null;
  private version = 0;
  private listeners = new Set<() => void>();
  private settling = false;
  private lastEn = true;
  private ticking: { cancel(): void } | null = null;
  private toneTimers = new Map<number, { cancel(): void }>();
  private readonly host: DeviceHost;

  constructor(project: Project, private opts: { seed?: number; board?: BoardProfile } = {}) {
    this.board = opts.board ?? DOIT_DEVKIT_V1;
    this.rand = rng(opts.seed ?? 1);
    this.host = {
      board: this.board,
      now: () => this.clock.now,
      termVolts: (part, term) => this.termVolts(part, term),
      current: (id) => this.sol?.current.get(id) ?? 0,
      supply: (part) => this.supply(part),
      boardPinsAt: (part, term) => { const n = this.netlist.netOf.get(termKey({ part, term })); return n == null ? [] : this.boardPinsOnNet(n); },
      pin: (gpio) => this.pins.get(gpio),
      input: (part, key) => this.input(part, key),
      invalidate: () => this.invalidate(),
      note: (i) => this.note(i),
    };
    this.fwTarget = this.firmwareTarget();
    this.setProject(project);
  }

  /** Framebuffers of the displays on the bench (OLED: mono, TFT: colour). */
  get framebuffers(): Map<string, MonoFramebuffer & ColorFramebuffer> {
    const m = new Map();
    for (const [id, s] of this.states) if (s?.fb) m.set(id, s.fb);
    return m;
  }

  /* ---------------- project / lifecycle ---------------- */

  /** Replace the circuit or program. A running sketch keeps running unless the program itself changed. */
  setProject(project: Project) {
    // in code mode only Run uploads a new sketch: editing the source (or the circuit) never restarts the board
    const modeChanged = this.project && (this.project.runMode ?? 'rules') !== (project.runMode ?? 'rules');
    const programChanged = modeChanged || (this.project && (project.runMode ?? 'rules') === 'rules' && JSON.stringify(this.project.program) !== JSON.stringify(project.program));
    this.project = project;
    this.netlist = buildNetlist(project, this.board);
    for (const id of [...this.inputs.keys()]) if (id !== BOARD_PART_ID && !project.parts.some((p) => p.id === id)) this.inputs.delete(id);
    for (const id of [...this.states.keys()]) {
      const part = project.parts.find((p) => p.id === id);
      if (!part || this.states.get(id).__type !== part.type) this.states.delete(id);
    }
    for (const p of project.parts) if (!this.states.has(p.id)) this.states.set(p.id, this.initState(p));
    // problems found while running describe the old circuit; checks re-run on the new one
    this.runtimeIssues.clear();
    if (programChanged && this.firmware === 'running') this.reboot('program changed');
    this.armTicks();
    this.invalidate();
  }

  private initState(p: PartInstance) {
    const m = MODELS[p.type];
    return { __type: p.type, ...(m ? m.init(p) : {}) };
  }

  get mode(): RunMode { return this.project.runMode ?? 'rules'; }

  /** Load a compiled sketch to run on the next boot (code mode). */
  upload(program: Compiled, source: string) {
    this.uploaded = { program, source };
  }

  clearUpload() { this.uploaded = null; }

  reset() {
    this.runner?.stop();
    this.runner = null;
    this.fault = null;
    this.cursor = null;
    this.i2cOverride = null;
    this.fwFns.clear();
    this.openLine = null;
    this.realtime = true;
    this.ticking = null;
    this.clock.clear();
    this.rand = rng(this.opts.seed ?? 1);
    this.firmware = 'none';
    this.bootedAt = null;
    this.serial = [];
    this.history.clear();
    this.pins.clear();
    this.toneTimers.clear();
    this.runtimeIssues.clear();
    this.floatingSample.clear();
    this.active = null;
    this.lastEn = true;
    this.states.clear();
    for (const p of this.project.parts) this.states.set(p.id, this.initState(p));
    for (const [id, inp] of this.inputs) {
      // momentary inputs are released
      if ('pressed' in inp) inp.pressed = false;
      if ('motion' in inp) inp.motion = false;
      if (id === BOARD_PART_ID) { inp.en = false; inp.boot = false; }
    }
    this.armTicks();
    this.invalidate();
  }

  /** Power-on boot (Run from idle). */
  start() {
    if (this.firmware === 'running') return;
    this.boot('POWERON_RESET');
  }

  private reboot(why: string) {
    this.log(`(restarting: ${why})`, 'sys');
    this.boot('POWERON_RESET');
  }

  private boot(reason: string) {
    this.runner?.stop();
    this.runner = null;
    this.pins.clear();
    this.fault = null;
    this.cursor = null;
    this.i2cOverride = null;
    this.fwFns.clear();
    this.openLine = null;
    for (const t of this.toneTimers.values()) t.cancel();
    this.toneTimers.clear();
    this.active = null;
    this.runtimeIssues.clear();
    for (const s of this.states.values()) s?.fb?.reset();
    this.invalidate();
    this.ensureSolved();
    // strapping pins have weak defaults inside the chip (GPIO12 pull-down, GPIO15 pull-up): only a pin that something
    // actually drives can override them
    const gpio0 = this.sol.v[this.internal('gpio0')];
    const io12 = this.drivenPinVolts(12), io15 = this.drivenPinVolts(15);
    const quiet = io15 != null && io15 < VIL;
    const boot = (s: string) => { if (!quiet) this.log(s, 'boot'); };
    if (this.sol.v[this.netOfPin('EN')] < VIL) {
      this.firmware = 'reset-held';
      this.log('(EN is held LOW: the ESP32 stays in reset)', 'sys');
      return;
    }
    boot('ets Jul 29 2019 12:21:46');
    boot('');
    if (gpio0 < VIL) {
      boot('rst:0x1 (POWERON_RESET),boot:0x3 (DOWNLOAD_BOOT(UART0/UART1/SDIO_REI_REO_V2))');
      boot('waiting for download');
      this.firmware = 'download';
      this.bootedAt = this.clock.now;
      this.note({ code: 'download-mode', severity: 'info', title: 'Board is in download mode', detail: 'GPIO0 (the BOOT button) was LOW at reset, so the ESP32 waits for a new upload instead of running the sketch.', fix: 'Release BOOT and press EN (or Reset) to run the sketch.', pins: ['GPIO0'] });
      return;
    }
    if (io12 != null && io12 > VIH) {
      boot(`rst:0x10 (RTCWDT_RTC_RESET),boot:0x33 (SPI_FAST_FLASH_BOOT)`);
      boot('flash read err, 1000');
      boot('ets_main.c 371');
      this.firmware = 'boot-failed';
      this.bootedAt = this.clock.now;
      this.note({ code: 'gpio12-high-at-boot', severity: 'error', title: 'GPIO12 is HIGH at reset, so the board cannot boot', detail: 'GPIO12 (MTDI) is a strapping pin. HIGH at reset selects 1.8 V flash, but the WROOM-32 has 3.3 V flash, so the boot loader cannot read it.', fix: 'Move whatever pulls GPIO12 up to another pin (or make sure it is LOW while the board resets).', pins: ['GPIO12'] });
      return;
    }
    boot(`rst:0x1 (${reason}),boot:0x13 (SPI_FAST_FLASH_BOOT)`);
    boot('configsip: 0, SPIWP:0xee');
    boot('clk_drv:0x00,q_drv:0x00,d_drv:0x00,cs0_drv:0x00,hd_drv:0x00,wp_drv:0x00');
    boot('mode:DIO, clock div:1');
    boot('load:0x3fff0030,len:4916');
    boot('load:0x40078000,len:16436');
    boot('entry 0x400805b8');
    if (this.mode === 'code') {
      if (!this.uploaded) {
        this.log('(no sketch uploaded yet: press Run in the Code tab)', 'sys');
        this.firmware = 'none';
        return;
      }
      this.firmware = 'running';
      this.bootedAt = this.clock.now;
      this.i2cOverride = { ...this.board.i2cDefault };
      this.runner = new FirmwareRunner(this.uploaded.program, this.fwTarget);
      this.runner.start();
      this.settle();
      return;
    }
    this.log('(simulated behaviour starts: no firmware is executed)', 'sys');
    this.firmware = 'running';
    this.bootedAt = this.clock.now;
    this.runner = new ProgramRunner(this.project.program, this);
    this.runner.start();
    this.settle();
  }

  /* ---------------- time ---------------- */

  /**
   * Advance simulated time by `ms`. A wall-clock budget keeps the page responsive: if the events (sketch slices,
   * physics ticks) take longer than `budgetMs` of real time, the rest is left for the next call and the simulation
   * runs slower than real time (reported in the snapshot) instead of freezing the browser.
   */
  advance(ms: number, budgetMs = Infinity) {
    const deadline = budgetMs === Infinity ? Infinity : performance.now() + budgetMs;
    this.realtime = this.clock.advanceTo(this.clock.now + ms, 1_000_000, deadline);
    this.emit();
  }

  /** Jump to the next scheduled event (or 10 ms if nothing is pending). Returns the new time. */
  stepToNext() {
    const next = this.clock.peek();
    this.clock.advanceTo(next ?? this.clock.now + 10);
    this.emit();
    return this.clock.now;
  }

  /** Physics tick for parts with continuous behaviour, on the virtual clock (so runs stay deterministic). */
  private armTicks() {
    const dynamic = this.project.parts.some((p) => MODELS[p.type]?.tick);
    if (!dynamic) { this.ticking?.cancel(); this.ticking = null; return; }
    if (this.ticking) return;
    const tick = (at: number) => {
      this.ticking = this.clock.schedule(at, () => {
        this.ticking = null;
        this.ensureSolved();
        for (const part of this.project.parts) {
          const m = MODELS[part.type];
          if (m?.tick) m.tick(part, this.states.get(part.id), TICK_MS, this.host, { ...getDef(part.type).defaults, ...part.params });
        }
        this.settle();
        if (this.project.parts.some((p) => MODELS[p.type]?.tick)) tick(at + TICK_MS);
      });
    };
    tick(this.clock.now + TICK_MS);
  }

  /* ---------------- user interaction ---------------- */

  interact(partId: string, key: string, value: unknown) {
    const inp = this.inputs.get(partId) ?? {};
    inp[key] = value;
    this.inputs.set(partId, inp);
    this.invalidate();
    this.settle();
    // a PIR reacts on its next tick; run its model now so the output follows immediately
    const part = this.project.parts.find((p) => p.id === partId);
    if (part && part.type === 'pir') { MODELS.pir.tick!(part, this.states.get(part.id), 0, this.host, { ...getDef('pir').defaults, ...part.params }); this.settle(); }
    this.emit();
  }

  input(partId: string, key: string) { return this.inputs.get(partId)?.[key]; }

  subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  private emit() { this.version++; for (const l of this.listeners) l(); }

  /* ---------------- HAL ---------------- */

  /** Simulated time: inside a sketch slice, the time of the instruction being executed. */
  now() { return this.cursor ? this.cursor() : this.clock.now; }
  millis() { return this.bootedAt == null ? 0 : this.now() - this.bootedAt; }
  random() { return this.rand(); }
  feed(id: string) { return getFeed(id)?.value(this.clock.now) ?? NaN; }

  pinMode(pin: number, mode: PinMode) {
    const def = this.gpioDef(pin);
    if (!def) { this.note({ code: 'no-such-pin', severity: 'error', title: `GPIO${pin} is not on this board`, detail: `The DOIT DevKit V1 header doesn't break out GPIO${pin}.` }); return; }
    const st = this.pinState(pin);
    st.mode = mode;
    st.pwm = null; st.servoUs = null; st.toneHz = null;
    if (mode === 'OUTPUT' && !def.caps.digitalOut) {
      this.note({ code: 'input-only-output', severity: 'error', title: `GPIO${pin} cannot be an output`, detail: `GPIO${pin} (${def.label}) is input-only on the ESP32: it has no output driver, so it will never drive anything.`, fix: 'Use an output-capable pin such as GPIO23, 22, 21, 19, 18, 17, 16, 4 or 25–27.', pins: [def.id] });
    }
    if ((mode === 'INPUT_PULLUP' || mode === 'INPUT_PULLDOWN') && !def.caps.pullUp) {
      this.note({ code: 'no-internal-pull', severity: 'warning', title: `GPIO${pin} has no internal pull resistor`, detail: `GPIO34–39 have no internal pull-up or pull-down, so ${mode} behaves like INPUT and the pin floats when nothing drives it.`, fix: 'Add an external 10 kΩ pull-up/pull-down, or use another pin.', pins: [def.id] });
    }
    this.invalidate();
    this.settle();
  }

  digitalWrite(pin: number, level: 0 | 1) {
    const def = this.gpioDef(pin);
    if (!def) return;
    const st = this.pinState(pin);
    // writing the level a plain output already has changes nothing (and a busy loop doing it must stay cheap)
    if (st.mode === 'OUTPUT' && st.level === level && st.pwm == null && st.servoUs == null && st.toneHz == null) return;
    if (st.mode !== 'OUTPUT') {
      this.note({ code: 'write-without-output', severity: 'warning', title: `digitalWrite on GPIO${pin}, which is not an OUTPUT`, detail: `GPIO${pin} is in ${st.mode} mode, so writing it doesn't drive the pin (on a real ESP32 it only changes the pull-up).`, fix: `Set GPIO${pin} to OUTPUT in the pin set-up.`, pins: [def.id] });
    }
    st.pwm = null; st.servoUs = null; st.toneHz = null;
    if (st.level !== level || st.mode === 'OUTPUT') this.record(pin, level);
    st.level = level;
    this.invalidate();
    this.settle();
  }

  outputLevel(pin: number) { return this.pinState(pin).level; }

  private claimOutput(pin: number, what: string) {
    const def = this.gpioDef(pin);
    if (!def) { this.note({ code: 'no-such-pin', severity: 'error', title: `GPIO${pin} is not on this board`, detail: `The DOIT DevKit V1 header doesn't break out GPIO${pin}.` }); return null; }
    if (!def.caps.pwm) {
      this.note({ code: 'pwm-input-only', severity: 'error', title: `GPIO${pin} can't output ${what}`, detail: `GPIO${pin} (${def.label}) is input-only: it has no output driver.`, fix: 'Use an output-capable pin.', pins: [def.id] });
      return null;
    }
    const st = this.pinState(pin);
    st.mode = 'OUTPUT';
    return st;
  }

  analogWrite(pin: number, duty: number) {
    const st = this.claimOutput(pin, 'PWM');
    if (!st) return;
    // Arduino-ESP32 3.x analogWrite() attaches LEDC and makes the pin an output
    st.servoUs = null; st.toneHz = null; st.pwmHz = 1000;
    st.pwm = duty <= 0 || duty >= 255 ? null : duty;
    st.level = duty >= 128 ? 1 : 0;
    if (duty <= 0) st.level = 0;
    if (duty >= 255) st.level = 1;
    this.record(pin, duty / 255);
    this.invalidate();
    this.settle();
  }

  servoWrite(pin: number, angle: number) {
    this.servoPulse(pin, SERVO_US[0] + (angle / 180) * (SERVO_US[1] - SERVO_US[0]));
  }

  /** A 50 Hz servo pulse of `us` microseconds on the pin. */
  servoPulse(pin: number, us: number) {
    const st = this.claimOutput(pin, 'a servo pulse');
    if (!st) return;
    if (st.servoUs === us) return;
    st.servoUs = us;
    st.toneHz = null; st.pwmHz = 50;
    // electrically a 50 Hz pulse: the average is what a meter (or an LED) on the pin would see
    st.pwm = Math.max(1, Math.round((us / 20000) * 255));
    st.level = 0;
    this.record(pin, us / 20000);
    this.invalidate();
    this.settle();
  }

  /** LEDC PWM: duty 0…1 at `hz`. A duty of 0 or 1 is a steady level. */
  pwmWrite(pin: number, duty: number, hz: number) {
    const st = this.claimOutput(pin, 'PWM');
    if (!st) return;
    duty = Math.max(0, Math.min(1, duty));
    const pwm = duty <= 0 || duty >= 1 ? null : duty * 255;
    const level = duty >= 0.5 ? 1 : 0;
    if (st.pwm === pwm && st.level === level && st.pwmHz === hz && st.servoUs == null && st.toneHz == null) return;
    st.servoUs = null; st.toneHz = null;
    st.pwm = pwm;
    st.pwmHz = hz > 0 ? hz : null;
    st.level = level;
    this.record(pin, duty);
    this.invalidate();
    this.settle();
  }

  tone(pin: number, hz: number, ms: number) {
    const st = this.claimOutput(pin, 'a tone');
    if (!st) return;
    if (st.toneHz === hz && ms <= 0 && !this.toneTimers.has(pin)) return;
    st.toneHz = hz;
    st.pwmHz = null;
    st.servoUs = null;
    st.pwm = 128;
    this.record(pin, 0.5);
    this.toneTimers.get(pin)?.cancel();
    this.toneTimers.delete(pin);
    if (ms > 0) this.toneTimers.set(pin, this.clock.schedule(this.now() + ms, () => { this.toneTimers.delete(pin); this.noTone(pin); this.settle(); }));
    this.invalidate();
    this.settle();
  }

  noTone(pin: number) {
    const st = this.pins.get(pin);
    if (!st) return;
    if (st.toneHz == null && !this.toneTimers.has(pin)) return;
    st.toneHz = null;
    st.pwm = null;
    st.level = 0;
    this.toneTimers.get(pin)?.cancel();
    this.toneTimers.delete(pin);
    this.record(pin, 0);
    this.invalidate();
    this.settle();
  }

  digitalRead(pin: number): 0 | 1 {
    this.ensureSolved();
    const def = this.gpioDef(pin);
    if (!def) return 0;
    const st = this.pinState(pin);
    if (st.mode === 'OUTPUT') return st.level;
    const net = this.netOfPin(def.id);
    if (!this.sol.driven.has(net)) {
      if (!this.floatingSample.has(pin)) this.floatingSample.set(pin, this.rand() < 0.5 ? 0 : 1);
      this.note({ code: 'floating-input', severity: 'warning', title: `GPIO${pin} is floating`, detail: `Nothing pulls GPIO${pin} HIGH or LOW, so digitalRead returns noise (here: a random level).`, fix: def.caps.pullUp ? `Use INPUT_PULLUP (button to GND) or add a pull-down resistor.` : 'Add an external pull-up or pull-down resistor: this pin has no internal ones.', pins: [def.id] });
      return this.floatingSample.get(pin)!;
    }
    return this.sol.v[net] > 1.65 ? 1 : 0;
  }

  analogRead(pin: number) {
    this.ensureSolved();
    const def = this.gpioDef(pin);
    if (!def?.caps.adc) {
      this.note({ code: 'not-adc', severity: 'error', title: `GPIO${pin} has no ADC`, detail: `analogRead needs an ADC pin (ADC1: GPIO32–39, ADC2: GPIO2, 4, 12–15, 25–27 on this board).`, pins: def ? [def.id] : [] });
      return 0;
    }
    const net = this.netOfPin(def.id);
    if (!this.sol.driven.has(net)) {
      this.note({ code: 'floating-input', severity: 'warning', title: `GPIO${pin} is floating`, detail: `analogRead on a pin nothing drives returns noise.`, fix: 'Connect the sensor or divider output to this pin.', pins: [def.id] });
      return Math.floor(this.rand() * 4096);
    }
    const v = this.sol.v[net];
    return Math.max(0, Math.min(4095, Math.round((v / 3.3) * 4095)));
  }

  serialPrintln(text: string) { this.log(text, 'out'); }

  /** quiet: a sketch prints its own failure messages; the behaviour program gets the library's usual one. */
  dhtRead(b: Extract<DeviceBinding, { kind: 'dht' }>, quiet = false): DhtResult {
    this.ensureSolved();
    const part = this.project.parts.find((p) => p.id === b.part);
    const fail = (reason: string, issue?: Omit<Issue, 'severity'> & { severity?: Issue['severity'] }) => {
      if (issue) this.note({ severity: 'error', ...issue });
      if (!quiet) this.log('Failed to read from DHT sensor!', 'out');
      return { ok: false as const, reason };
    };
    if (!part || getDef(part.type).device !== 'dht') return fail('missing', { code: 'device-missing', title: `The program uses a DHT sensor (${b.part}) that isn't on the workspace`, detail: 'Add the sensor or pick another one in the device set-up.' });
    const def = getDef(part.type);
    const supply = this.supply(part.id);
    if (supply == null || supply < def.power!.minV) {
      return fail('no-power', { code: 'device-unpowered', title: `${part.label} has no power`, detail: `${part.label} needs ${def.power!.minV}–${def.power!.maxV} V between VCC and GND; it measures ${(supply ?? 0).toFixed(2)} V.`, fix: 'Wire VCC to 3V3 and GND to a GND pin.', parts: [part.id] });
    }
    const pinDef = this.gpioDef(b.pin);
    const dataNet = this.netlist.netOf.get(termKey({ part: part.id, term: 'DATA' }))!;
    if (!pinDef || dataNet !== this.netOfPin(pinDef.id)) {
      const other = this.boardPinsOnNet(dataNet).find((p) => p.gpio != null);
      return fail('not-on-pin', { code: 'dht-wrong-pin', title: `${part.label} DATA isn't on GPIO${b.pin}`, detail: other ? `The program reads the sensor on GPIO${b.pin}, but DATA is wired to GPIO${other.gpio}.` : `The program reads the sensor on GPIO${b.pin}, but the DATA pin isn't wired to it.`, fix: other ? `Change the sensor pin ${quiet ? 'in the sketch' : 'in the behaviour'} to GPIO${other.gpio}, or move the wire.` : `Wire DATA to GPIO${b.pin}.`, parts: [part.id], pins: pinDef ? [pinDef.id] : [] });
    }
    const st = this.states.get(part.id);
    const minGap = b.model === 'DHT22' ? 2000 : 1000;
    if (st.lastReadAt != null && this.now() - st.lastReadAt < minGap && st.last) {
      this.note({ code: 'dht-too-fast', severity: 'info', title: `${part.label} read too often`, detail: `A ${b.model} measures at most once every ${minGap / 1000} s; faster reads return the previous result (the library caches it).`, parts: [part.id] });
      return { ok: true, ...st.last };
    }
    const T = Number(part.params.temperature ?? 22), H = Number(part.params.humidity ?? 50);
    const jitter = () => (this.rand() - 0.5) * 0.2;
    const reading = b.model === 'DHT22'
      ? { temperature: round1(clamp(T + jitter(), -40, 80)), humidity: round1(clamp(H + jitter() * 2, 0, 100)) }
      : { temperature: Math.round(clamp(T, 0, 50)), humidity: Math.round(clamp(H, 20, 80)) };
    st.lastReadAt = this.now();
    st.last = reading;
    this.clearIssuesFor(part.id, ['device-unpowered', 'dht-wrong-pin']);
    return { ok: true, ...reading };
  }

  bmeRead(b: Extract<DeviceBinding, { kind: 'bme280' }>, quiet = false): BmeResult {
    this.ensureSolved();
    const part = this.project.parts.find((p) => p.id === b.part);
    if (!part || getDef(part.type).device !== 'bme280') {
      this.note({ code: 'device-missing', severity: 'error', title: `The program uses a BME280 (${b.part}) that isn't on the workspace`, detail: 'Add the sensor or pick another one in the device set-up.' });
      return { ok: false, reason: 'missing' };
    }
    const problem = this.i2cProblem(part.id, b.address);
    if (problem) { this.note(problem); if (!quiet) this.log('Could not find a valid BME280 sensor, check wiring!', 'out'); return { ok: false, reason: problem.code }; }
    const p = { ...getDef('bme280').defaults, ...part.params } as Record<string, number>;
    const j = (k: number) => (this.rand() - 0.5) * k;
    const r = { temperature: round2(clamp(Number(p.temperature) + j(0.1), -40, 85)), humidity: round1(clamp(Number(p.humidity) + j(0.4), 0, 100)), pressure: round1(clamp(Number(p.pressure) + j(0.2), 300, 1100)) };
    this.states.get(part.id).last = r;
    this.clearIssuesFor(part.id, I2C_CODES);
    return { ok: true, ...r };
  }

  oledDraw(b: Extract<DeviceBinding, { kind: 'ssd1306' }>, draw: (fb: MonoFramebuffer) => void): DeviceResult {
    this.ensureSolved();
    const part = this.project.parts.find((p) => p.id === b.part);
    if (!part || getDef(part.type).device !== 'ssd1306') {
      this.note({ code: 'device-missing', severity: 'error', title: `The program uses an OLED (${b.part}) that isn't on the workspace`, detail: 'Add the display or pick another one in the device set-up.' });
      return { ok: false, reason: 'missing' };
    }
    const problem = this.i2cProblem(part.id, b.address);
    if (problem) { this.note(problem); return { ok: false, reason: problem.code }; }
    this.clearIssuesFor(part.id, I2C_CODES);
    const fb = this.states.get(part.id).fb as MonoFramebuffer;
    draw(fb);
    fb.commit();
    return { ok: true };
  }

  tftDraw(b: Extract<DeviceBinding, { kind: 'tft' }>, draw: (fb: ColorFramebuffer) => void): DeviceResult {
    this.ensureSolved();
    const part = this.project.parts.find((p) => p.id === b.part);
    if (!part || getDef(part.type).device !== 'tft') {
      this.note({ code: 'device-missing', severity: 'error', title: `The program uses a TFT (${b.part}) that isn't on the workspace`, detail: 'Add the display or pick another one in the device set-up.' });
      return { ok: false, reason: 'missing' };
    }
    const problem = this.spiProblem(part.id, b);
    if (problem) { this.note(problem); return { ok: false, reason: problem.code }; }
    this.clearIssuesFor(part.id, SPI_CODES);
    const fb = this.states.get(part.id).fb as ColorFramebuffer;
    draw(fb);
    fb.commit();
    return { ok: true };
  }

  schedule(at: number, fn: () => void) {
    return this.clock.schedule(at, () => { fn(); this.settle(); });
  }

  note(issue: Issue) {
    const key = `${issue.code}|${(issue.parts ?? []).join(',')}|${(issue.pins ?? []).join(',')}`;
    if (!this.runtimeIssues.has(key)) this.runtimeIssues.set(key, issue);
  }

  private clearIssuesFor(partId: string, codes: string[]) {
    for (const [k, i] of this.runtimeIssues) if (codes.includes(i.code) && i.parts?.includes(partId)) this.runtimeIssues.delete(k);
  }

  markActive(ruleId: string, actionId?: string) { this.active = { ruleId, actionId, t: this.clock.now }; }

  /* ---------------- electrical model ---------------- */

  invalidate() { this.dirty = true; }

  /** Re-solve if needed, then let the program react to new input levels (edge triggers) and EN changes. */
  settle() {
    if (this.settling) return;
    this.settling = true;
    try {
      for (let i = 0; i < 20; i++) {
        this.ensureSolved();
        const enHigh = this.sol.v[this.netOfPin('EN')] >= VIL;
        if (!enHigh && this.lastEn && (this.firmware === 'running' || this.firmware === 'download' || this.firmware === 'boot-failed' || this.firmware === 'crashed')) {
          this.runner?.stop();
          this.runner = null;
          this.pins.clear();
          this.firmware = 'reset-held';
          this.invalidate();
          this.lastEn = enHigh;
          continue;
        }
        if (enHigh && !this.lastEn && this.firmware === 'reset-held') {
          this.lastEn = enHigh;
          this.boot('POWERON_RESET');
          continue;
        }
        this.lastEn = enHigh;
        this.runner?.onInputsChanged();
        this.recordInputs();
        if (!this.dirty) break;
      }
    } finally {
      this.settling = false;
    }
  }

  private ensureSolved() {
    if (!this.dirty) return;
    this.dirty = false;
    this.sol = this.solveAll();
    this.floatingSample.forEach((_, pin) => { const d = this.gpioDef(pin); if (d && this.sol.driven.has(this.netOfPin(d.id))) this.floatingSample.delete(pin); });
  }

  internal(name: string) {
    let n = this.internalNodes.get(name);
    if (n == null) { n = this.nodeCount++; this.internalNodes.set(name, n); }
    return n;
  }

  private solveAll(): CombinedSolution {
    const pwmPins = [...this.pins.entries()].filter(([, s]) => s.mode === 'OUTPUT' && s.pwm != null).map(([g, s]) => ({ gpio: g, duty: s.pwm! / 255 }));
    // Two passes per state: the first finds node voltages, the second lets modules react to them (regulators,
    // driver logic inputs, sensor outputs).
    const pass = (high: Set<number>): { s: Solution; els: Element[]; supplies: Map<string, number> } => {
      let prev: Solution | null = null;
      let supplies = new Map<string, number>();
      let out!: { s: Solution; els: Element[] };
      for (let k = 0; k < 2; k++) {
        const els = this.elements(k === 0 ? null : supplies, prev, high);
        const s = solve(this.nodeCount, els);
        out = { s, els };
        prev = s;
        supplies = this.measureSupplies(s);
      }
      return { ...out, supplies };
    };
    if (!pwmPins.length) {
      const one = pass(new Set());
      return { ...one.s, els: one.els, supplies: one.supplies, driven: drivenNodes(this.nodeCount, one.els, one.s), weight: null };
    }
    // PWM is averaged by decomposition: a base state with every PWM pin LOW, plus each PWM pin HIGH on its own,
    // weighted by its duty. Exact for independent branches (an LED or RGB channel per pin); an approximation where
    // PWM'd branches interact (see README).
    const base = pass(new Set());
    const each = pwmPins.map((p) => ({ duty: p.duty, r: pass(new Set([p.gpio])) }));
    const v = Float64Array.from(base.s.v);
    for (const { duty, r } of each) for (let i = 0; i < v.length; i++) v[i] += duty * ((r.s.v[i] ?? 0) - (base.s.v[i] ?? 0));
    const ids = new Set<string>([...base.s.current.keys()]);
    for (const { r } of each) for (const id of r.s.current.keys()) ids.add(id);
    const current = new Map<string, number>();
    for (const id of ids) {
      const b = base.s.current.get(id) ?? 0;
      let c = b;
      for (const { duty, r } of each) c += duty * ((r.s.current.get(id) ?? 0) - b);
      current.set(id, c);
    }
    const diodeOn = new Set([...base.s.diodeOn, ...each.flatMap((e) => [...e.r.s.diodeOn])]);
    // what is "driven" and the supplies come from the state with every PWM pin HIGH
    const all = pass(new Set(pwmPins.map((p) => p.gpio)));
    return { v, current, diodeOn, converged: base.s.converged && each.every((e) => e.r.s.converged), els: all.els, supplies: all.supplies, driven: drivenNodes(this.nodeCount, all.els, all.s), weight: Math.max(...pwmPins.map((p) => p.duty)) };
  }

  private elements(supplies: Map<string, number> | null, prev: Solution | null, pwmHigh: Set<number>): Element[] {
    const nl = this.netlist;
    this.nodeCount = nl.nets.length;
    this.internalNodes.clear();
    const B = this.board;
    const n = (pinId: string) => this.netOfPin(pinId);
    const els: Element[] = [];
    // board power and housekeeping
    els.push({ kind: 'V', id: 'board.3v3', p: n('3V3'), n: 0, volts: 3.3, ohms: 0.2 });
    els.push({ kind: 'V', id: 'board.vin', p: n('VIN'), n: 0, volts: 5.0, ohms: 0.3 });
    els.push({ kind: 'R', id: 'board.en_pu', a: n('EN'), b: n('3V3'), ohms: 10_000 });
    const enInp = this.inputs.get(BOARD_PART_ID) ?? {};
    els.push({ kind: 'SW', id: 'board.en_btn', a: n('EN'), b: 0, closed: !!enInp.en });
    const g0 = this.internal('gpio0');
    els.push({ kind: 'R', id: 'board.gpio0_pu', a: g0, b: n('3V3'), ohms: 10_000 });
    els.push({ kind: 'SW', id: 'board.boot_btn', a: g0, b: 0, closed: !!enInp.boot });
    const ledMid = this.internal('led2');
    els.push({ kind: 'R', id: 'board.led2_r', a: n('GPIO2'), b: ledMid, ohms: B.onboardLed.seriesOhms });
    els.push({ kind: 'D', id: 'board.led2', a: ledMid, b: 0, vf: B.onboardLed.vf, rs: 20 });
    // GPIO drivers and pulls
    for (const [gpio, st] of this.pins) {
      const def = this.gpioDef(gpio);
      if (!def) continue;
      const node = n(def.id);
      if (st.mode === 'OUTPUT' && def.caps.digitalOut) {
        const level = st.pwm != null ? (pwmHigh.has(gpio) ? 1 : 0) : st.level;
        els.push({ kind: 'V', id: `gpio.${gpio}`, p: node, n: 0, volts: level ? B.logicVolts : 0, ohms: B.outputOhms });
      } else if (st.mode === 'INPUT_PULLUP' && def.caps.pullUp) {
        els.push({ kind: 'R', id: `gpio.${gpio}.pu`, a: node, b: n('3V3'), ohms: B.pullOhms });
      } else if (st.mode === 'INPUT_PULLDOWN' && def.caps.pullDown) {
        els.push({ kind: 'R', id: `gpio.${gpio}.pd`, a: node, b: 0, ohms: B.pullOhms });
      }
    }
    // parts
    for (const part of this.project.parts) {
      const def = getDef(part.type);
      const node = (t: string) => nl.netOf.get(termKey({ part: part.id, term: t }))!;
      const ctx: ElectricalCtx = {
        node,
        internal: (name) => this.internal(`${part.id}.${name}`),
        params: { ...def.defaults, ...part.params },
        inputs: this.inputs.get(part.id) ?? {},
        id: (name) => `${part.id}.${name}`,
        supply: supplies ? supplies.get(part.id) ?? 0 : null,
        volts: (t) => (prev ? prev.v[node(t)] ?? 0 : null),
        state: this.states.get(part.id),
      };
      els.push(...def.electrical(ctx));
    }
    return els;
  }

  private measureSupplies(s: Solution) {
    const out = new Map<string, number>();
    for (const part of this.project.parts) {
      const def = getDef(part.type);
      if (!def.power) continue;
      const a = this.netlist.netOf.get(termKey({ part: part.id, term: def.power.vcc }))!;
      const b = this.netlist.netOf.get(termKey({ part: part.id, term: def.power.gnd }))!;
      out.set(part.id, s.v[a] - s.v[b]);
    }
    return out;
  }

  private supply(partId: string) {
    const part = this.project.parts.find((p) => p.id === partId);
    if (!part) return null;
    const def = getDef(part.type);
    if (!def.power) return null;
    const v = this.sol.supplies.get(partId);
    if (v == null) return null;
    // a module only counts as powered if its GND really reaches ground (or VCC really reaches a supply)
    const a = this.netlist.netOf.get(termKey({ part: partId, term: def.power.vcc }))!;
    const b = this.netlist.netOf.get(termKey({ part: partId, term: def.power.gnd }))!;
    if (!this.sol.driven.has(a) || !this.sol.driven.has(b)) return 0;
    return v;
  }

  private termVolts(partId: string, term: string) {
    const n = this.netlist.netOf.get(termKey({ part: partId, term }));
    if (n == null || !this.sol) return NaN;
    return this.sol.driven.has(n) ? this.sol.v[n] : NaN;
  }

  private powerProblem(part: PartInstance, def: ComponentDef, what: string): Issue | null {
    const supply = this.supply(part.id);
    if (supply == null || supply < def.power!.minV) {
      return { code: 'device-unpowered', severity: 'error', title: `${part.label} has no power`, detail: `${part.label} needs ${def.power!.minV}–${def.power!.maxV} V between VCC and GND; it measures ${(supply ?? 0).toFixed(2)} V. ${what}`, fix: 'Wire VCC to 3V3 and GND to a GND pin.', parts: [part.id] };
    }
    return null;
  }

  /** Why an I²C device would not answer at `address` on the program's bus, or null if it would. */
  private i2cProblem(partId: string, address: number): Issue | null {
    const part = this.project.parts.find((p) => p.id === partId)!;
    const def = getDef(part.type);
    const pw = this.powerProblem(part, def, 'It will not answer on the bus.');
    if (pw) return pw;
    const { sda, scl } = this.i2cBus();
    const sdaNet = this.netlist.netOf.get(termKey({ part: partId, term: 'SDA' }))!;
    const sclNet = this.netlist.netOf.get(termKey({ part: partId, term: 'SCL' }))!;
    const sdaPin = this.gpioDef(sda), sclPin = this.gpioDef(scl);
    if (sdaPin && sclPin && sdaNet === this.netOfPin(sclPin.id) && sclNet === this.netOfPin(sdaPin.id)) {
      return { code: 'i2c-swapped', severity: 'error', title: `${part.label}: SDA and SCL are swapped`, detail: `SDA is wired to GPIO${scl} (the clock) and SCL to GPIO${sda} (the data line), so the device never acknowledges.`, fix: `Swap the two wires: SDA → GPIO${sda}, SCL → GPIO${scl}.`, parts: [partId], pins: [sdaPin.id, sclPin.id] };
    }
    if (!sdaPin || sdaNet !== this.netOfPin(sdaPin.id) || !sclPin || sclNet !== this.netOfPin(sclPin.id)) {
      const bad = [!sdaPin || sdaNet !== this.netOfPin(sdaPin.id) ? `SDA → GPIO${sda}` : '', !sclPin || sclNet !== this.netOfPin(sclPin.id) ? `SCL → GPIO${scl}` : ''].filter(Boolean).join(' and ');
      return { code: 'i2c-not-wired', severity: 'error', title: `${part.label} isn't on the I²C bus`, detail: `The program talks I²C on SDA = GPIO${sda}, SCL = GPIO${scl}. Missing: ${bad}.`, fix: `Wire ${bad}, or change the I²C pins ${this.i2cOverride ? 'with Wire.begin(sda, scl)' : 'in the behaviour set-up'}.`, parts: [partId] };
    }
    const partAddr = Number(part.params.address ?? def.defaults.address);
    if (partAddr !== address) {
      return { code: 'i2c-address', severity: 'error', title: `${part.label} answers at 0x${hex(partAddr)}, not 0x${hex(address)}`, detail: `The program addresses it at 0x${hex(address)}, but the module is set to 0x${hex(partAddr)}.`, fix: 'Make the program and the module use the same address.', parts: [partId] };
    }
    const twins = this.project.parts.filter((p) => p.id !== partId && I2C_TYPES.includes(p.type) && Number(p.params.address ?? getDef(p.type).defaults.address) === partAddr
      && this.netlist.netOf.get(termKey({ part: p.id, term: 'SDA' })) === sdaNet);
    if (twins.length) {
      return { code: 'i2c-conflict', severity: 'error', title: `Two devices answer at 0x${hex(partAddr)}`, detail: `${part.label} and ${twins.map((t) => t.label).join(', ')} share the bus and the address, so both reply at once and the data is garbled.`, fix: 'Change one module\'s address (its jumper) and use that address in the program.', parts: [partId, ...twins.map((t) => t.id)] };
    }
    return null;
  }

  /** Why a TFT on hardware SPI would not show what the program draws, or null if it would. */
  private spiProblem(partId: string, b: Extract<DeviceBinding, { kind: 'tft' }>): Issue | null {
    const part = this.project.parts.find((p) => p.id === partId)!;
    const def = getDef(part.type);
    const pw = this.powerProblem(part, def, 'The screen stays blank.');
    if (pw) return pw;
    const at = (t: string) => this.netlist.netOf.get(termKey({ part: partId, term: t }))!;
    const want: [string, number, string][] = [['SCK', this.board.spiDefault.sck, 'SPI clock'], ['SDA', this.board.spiDefault.mosi, 'SPI data (MOSI)'], ['CS', b.cs, 'chip select'], ['DC', b.dc, 'data/command']];
    if (b.rst >= 0) want.push(['RST', b.rst, 'reset']);
    const wrong = want.filter(([t, g]) => { const d = this.gpioDef(g); return !d || at(t) !== this.netOfPin(d.id); });
    if (wrong.length) {
      const list = wrong.map(([t, g, what]) => `${t} (${what}) → GPIO${g}`).join(', ');
      return { code: 'spi-not-wired', severity: 'error', title: `${part.label} isn't wired the way the program drives it`, detail: `The program expects ${list}. Hardware SPI on the ESP32 uses SCK = GPIO18 and MOSI = GPIO23.`, fix: `Wire ${list}, or change the TFT pins ${this.mode === 'code' ? 'in the sketch' : 'in the behaviour set-up'}.`, parts: [partId] };
    }
    if (b.rst < 0 && !this.boardPinsOnNet(at('RST')).some((p) => p.id === '3V3')) {
      return { code: 'spi-reset-floating', severity: 'error', title: `${part.label}: RESET isn't connected`, detail: 'With RESET left open the display controller never starts reliably.', fix: 'Wire RESET to 3V3 (or to a GPIO and set it as the reset pin).', parts: [partId] };
    }
    return null;
  }

  /* ---------------- helpers ---------------- */

  gpioDef(gpio: number): PinDef | undefined { return this.board.pins.find((p) => p.gpio === gpio); }
  netOfPin(pinId: string) { return this.netlist.netOf.get(`${BOARD_PART_ID}:${pinId}`)!; }
  private drivenPinVolts(gpio: number) {
    const d = this.gpioDef(gpio);
    if (!d) return null;
    const n = this.netOfPin(d.id);
    return this.sol.driven.has(n) ? this.sol.v[n] : null;
  }
  boardPinsOnNet(net: number) { return this.board.pins.filter((p) => this.netOfPin(p.id) === net); }

  private pinState(gpio: number): PinRuntime {
    let s = this.pins.get(gpio);
    if (!s) { s = { mode: 'UNSET', level: 0, pwm: null }; this.pins.set(gpio, s); }
    return s;
  }

  private log(text: string, kind: SerialLine['kind']) {
    this.openLine = null;
    this.serial.push({ t: this.now(), text, kind });
    if (this.serial.length > SERIAL_MAX) this.serial.splice(0, this.serial.length - SERIAL_MAX);
  }

  /** Raw serial output from a sketch: print() without a newline keeps the line open. */
  serialOut(text: string) {
    const parts = text.split('\n');
    parts.forEach((chunk, i) => {
      if (i > 0) this.openLine = null;
      if (!chunk && i === parts.length - 1) return;
      const clean = chunk.replace(/\r/g, '');
      if (this.openLine) { this.openLine.text += clean; return; }
      const line: SerialLine = { t: this.now(), text: clean, kind: 'out' };
      this.serial.push(line);
      if (this.serial.length > SERIAL_MAX) this.serial.splice(0, this.serial.length - SERIAL_MAX);
      this.openLine = line;
    });
    // a complete line closes; a line ending without "\n" stays open for the next print()
    if (text.endsWith('\n')) this.openLine = null;
  }

  /** Text typed into the serial monitor (sent with a newline). */
  serialInput(text: string) {
    if (this.runner instanceof FirmwareRunner) this.runner.serialInput(text);
  }

  private record(gpio: number, v: number) {
    let h = this.history.get(gpio);
    if (!h) { h = []; this.history.set(gpio, h); }
    const last = h[h.length - 1];
    if (last && last.v === v) return;
    const t = this.now();
    if (last && last.t === t) last.v = v; else h.push({ t, v });
    if (h.length > HISTORY_MAX) h.splice(0, h.length - HISTORY_MAX);
  }

  /** Inputs (and wired-but-unconfigured pins) are sampled into the history so the signal view shows them too. */
  private recordInputs() {
    if (!this.sol) return;
    for (const p of this.board.pins) {
      if (p.gpio == null) continue;
      const st = this.pins.get(p.gpio);
      if (st?.mode === 'OUTPUT') continue;
      const net = this.netOfPin(p.id);
      if (this.netlist.nets[net].terms.length < 2 && !st) continue;
      if (!this.sol.driven.has(net)) continue;
      this.record(p.gpio, this.sol.v[net] > 1.65 ? 1 : 0);
    }
  }

  /* ---------------- reporting ---------------- */

  snapshot(): Snapshot {
    this.ensureSolved();
    const sol = this.sol;
    const pins: Record<string, PinSnapshot> = {};
    for (const p of this.board.pins) {
      const net = this.netOfPin(p.id);
      const st = p.gpio != null ? this.pins.get(p.gpio) : undefined;
      const floating = !sol.driven.has(net);
      const volts = floating ? 0 : sol.v[net];
      const src = p.gpio != null ? sol.current.get(`gpio.${p.gpio}`) ?? 0 : p.id === '3V3' ? sol.current.get('board.3v3') ?? 0 : p.id === 'VIN' ? sol.current.get('board.vin') ?? 0 : 0;
      pins[p.id] = {
        id: p.id, gpio: p.gpio, mode: st?.mode ?? 'UNSET', level: st?.level ?? 0, pwm: st?.pwm ?? null,
        servoUs: st?.servoUs ?? null, toneHz: st?.toneHz ?? null,
        fn: this.pinFunction(p.gpio, st), volts, net, floating: p.kind === 'gpio' && floating,
        read: p.kind !== 'gpio' ? null : st?.mode === 'OUTPUT' ? st.level : floating ? null : volts > 1.65 ? 1 : 0,
        ma: src * 1000,
      };
    }
    const parts: Record<string, PartSnapshot> = {};
    for (const part of this.project.parts) {
      const m = MODELS[part.type];
      const params = { ...getDef(part.type).defaults, ...part.params };
      parts[part.id] = { id: part.id, ...(m ? m.view(part, this.states.get(part.id), this.host, params) : { readings: [], visual: {} }) };
    }
    const led2 = (sol.current.get('board.led2') ?? 0) * 1000;
    const enInp = this.inputs.get(BOARD_PART_ID) ?? {};
    const seen = new Set<string>();
    const order = { error: 0, warning: 1, info: 2 };
    // in code mode the behaviour rules are not what runs, so checks look at the circuit only
    const checked = this.mode === 'code' ? { ...this.project, program: { ...emptyProgram(), i2c: this.i2cBus() } } : this.project;
    const issues = [
      ...staticChecks({ project: checked, board: this.board, netlist: this.netlist }),
      ...electricalChecks({ project: checked, board: this.board, netlist: this.netlist, pins, parts, sol, firmware: this.firmware }),
      ...this.runtimeIssues.values(),
    ].filter((i) => { const k = `${i.code}|${(i.parts ?? []).join()}|${(i.pins ?? []).join()}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => order[a.severity] - order[b.severity]);
    return {
      t: this.clock.now,
      firmware: this.firmware,
      bootedAt: this.bootedAt,
      pins,
      parts,
      board: { powered: true, led2: Math.min(1, led2 / 0.25), enDown: !!enInp.en, bootDown: !!enInp.boot },
      serial: this.serial.map((l) => (l === this.openLine ? { ...l } : l)),
      issues,
      netNames: this.netlist.nets.map((n) => n.name),
      netVolts: this.netlist.nets.map((n) => (sol.driven.has(n.index) ? sol.v[n.index] : NaN)),
      vars: this.runner instanceof FirmwareRunner ? this.sketchGlobals(this.runner) : Object.fromEntries(this.runner?.vars ?? []),
      active: this.active,
      fw: {
        mode: this.mode,
        uploaded: this.mode === 'code' && this.uploaded && this.firmware !== 'none' ? this.uploaded.source : null,
        line: this.runner instanceof FirmwareRunner ? this.runner.line : this.fault?.line ?? null,
        fault: this.fault,
        realtime: this.realtime,
      },
      nets: this.netStates(pins),
      version: this.version,
    };
  }

  /** Numeric globals of the running sketch, for the variables view. */
  private sketchGlobals(r: FirmwareRunner) {
    const out: Record<string, number> = {};
    for (const g of r.vm.prog.globalNames) {
      if (g.kind === 'obj' || g.kind === 'arr' || g.kind === 'str') continue;
      const v = r.vm.globals[g.slot];
      if (typeof v === 'number') out[g.name] = v;
    }
    return out;
  }

  private netStates(pins: Record<string, PinSnapshot>): NetInfo[] {
    const sol = this.sol;
    return this.netlist.nets.map((n): NetInfo => {
      const driven = sol.driven.has(n.index);
      const volts = driven && sol.converged ? sol.v[n.index] : null;
      const boardPins = this.boardPinsOnNet(n.index);
      let state: NetState;
      if (!sol.converged) state = 'unknown';
      else if (boardPins.some((p) => p.kind === 'ground')) state = 'ground';
      else if (boardPins.some((p) => p.kind === 'power')) state = 'power';
      else {
        const gp = boardPins.map((p) => pins[p.id]).filter((p) => p && p.gpio != null);
        const out = gp.find((p) => p.mode === 'OUTPUT');
        const pulled = gp.find((p) => p.mode === 'INPUT_PULLUP' || p.mode === 'INPUT_PULLDOWN');
        if (out) state = out.pwm != null || out.servoUs != null || out.toneHz != null ? 'gpio-pwm' : out.level ? 'gpio-high' : 'gpio-low';
        else if (!driven) state = gp.length ? 'high-z' : 'floating';
        else if (pulled && !this.otherSourceOn(n.index, pulled.gpio!)) state = pulled.mode === 'INPUT_PULLUP' ? 'pulled-up' : 'pulled-down';
        else state = 'driven';
      }
      return { index: n.index, name: n.name, volts, state };
    });
  }

  /** Is a net still driven with the pull resistor of `gpio` taken away? (tells "pulled" from "driven") */
  private otherSourceOn(net: number, gpio: number) {
    const els = this.sol.els.filter((e) => e.id !== `gpio.${gpio}.pu` && e.id !== `gpio.${gpio}.pd`);
    return drivenNodes(this.nodeCount, els, this.sol).has(net);
  }

  /* ---------------- the sketch's view of the hardware (code mode) ---------------- */

  private i2cBus() { return this.i2cOverride ?? this.project.program.i2c; }

  private partsOf(device: string) { return this.project.parts.filter((p) => getDef(p.type).device === device); }
  private addrOf(p: PartInstance) { return Number(p.params.address ?? getDef(p.type).defaults.address); }

  private missing(what: string, detail: string) {
    this.note({ code: 'device-missing', severity: 'error', title: `The sketch uses ${what}, but there is none on the workspace`, detail, fix: 'Add the part from the catalogue and wire it up.' });
  }

  private firmwareTarget(): FirmwareTarget {
    const e = this;
    const claimI2c = () => { const b = e.i2cBus(); e.fwFns.set(b.sda, 'I²C SDA'); e.fwFns.set(b.scl, 'I²C SCL'); };
    return {
      get clockNow() { return e.clock.now; },
      millis: () => (e.bootedAt == null ? 0 : e.clock.now - e.bootedAt),
      schedule: (at, fn) => e.schedule(at, fn),
      setCursor: (fn) => { e.cursor = fn; },
      pinMode: (pin, mode) => e.pinMode(pin, mode),
      digitalWrite: (pin, level) => e.digitalWrite(pin, level),
      digitalRead: (pin) => e.digitalRead(pin),
      pinLevel: (pin) => e.pinLevel(pin),
      analogRead: (pin) => e.analogRead(pin),
      pinVolts: (pin) => { e.ensureSolved(); const d = e.gpioDef(pin); if (!d) return 0; const n = e.netOfPin(d.id); return e.sol.driven.has(n) ? e.sol.v[n] : 0; },
      pwmWrite: (pin, duty, hz) => e.pwmWrite(pin, duty, hz),
      tone: (pin, hz, ms) => e.tone(pin, hz, ms),
      noTone: (pin) => e.noTone(pin),
      servoPulse: (pin, us) => e.servoPulse(pin, us),
      serialOut: (text) => e.serialOut(text),
      random: () => e.rand(),
      reseed: (seed) => { e.rand = rng(seed >>> 0 || 1); },
      setI2cPins: (sda, scl) => { e.i2cOverride = { sda, scl }; e.invalidate(); },
      i2cAck: (addr) => {
        e.ensureSolved();
        claimI2c();
        return e.project.parts.some((p) => I2C_TYPES.includes(p.type) && e.addrOf(p) === addr && !e.i2cProblem(p.id, addr));
      },
      oledShow: (addr, pixels) => {
        e.ensureSolved();
        claimI2c();
        const oleds = e.partsOf('ssd1306');
        if (!oleds.length) { e.missing('an SSD1306 OLED', `display.display() sends the picture to an OLED at 0x${hex(addr)}.`); return; }
        const target = oleds.find((p) => e.addrOf(p) === addr && !e.i2cProblem(p.id, addr));
        if (!target) {
          const p = oleds.find((q) => e.addrOf(q) === addr) ?? oleds[0];
          const problem = e.i2cProblem(p.id, addr);
          if (problem) e.note(problem);
          return;
        }
        e.clearIssuesFor(target.id, I2C_CODES);
        const fb = e.states.get(target.id).fb as MonoFramebuffer;
        for (let y = 0; y < fb.height; y++) for (let x = 0; x < fb.width; x++) fb.buf[y * fb.width + x] = pixels[y * 128 + x] ?? 0;
        fb.commit();
      },
      bmeAt: (addr, probeOnly) => {
        e.ensureSolved();
        claimI2c();
        const bmes = e.partsOf('bme280');
        if (!bmes.length) { e.missing('a BME280 sensor', `bme.begin(0x${hex(addr)}) looks for a BME280 on the I²C bus.`); return null; }
        const part = bmes.find((p) => e.addrOf(p) === addr && !e.i2cProblem(p.id, addr)) ?? bmes.find((p) => e.addrOf(p) === addr) ?? bmes[0];
        const r = probeOnly
          ? (() => { const pr = e.i2cProblem(part.id, addr); if (pr) { e.note(pr); return null; } e.clearIssuesFor(part.id, I2C_CODES); return { temperature: 0, humidity: 0, pressure: 0 }; })()
          : (() => { const x = e.bmeRead({ id: 'sketch', kind: 'bme280', part: part.id, address: addr }, true); return x.ok ? x : null; })();
        return r;
      },
      dhtAt: (pin, model) => {
        e.ensureSolved();
        const dhts = e.partsOf('dht');
        if (!dhts.length) { e.missing('a DHT sensor', `dht.read…() on GPIO${pin} needs a DHT11 or DHT22.`); return null; }
        const d = e.gpioDef(pin);
        const onPin = d ? dhts.find((p) => e.netlist.netOf.get(termKey({ part: p.id, term: 'DATA' })) === e.netOfPin(d.id)) : undefined;
        const part = onPin ?? dhts[0];
        e.fwFns.set(pin, 'DHT data');
        const partModel = part.type === 'dht11' ? 11 : 22;
        const wanted = model === 11 ? 11 : 22;
        if (onPin && partModel !== wanted) {
          e.note({ code: 'dht-model', severity: 'error', title: `The sketch reads a DHT${wanted}, but ${part.label} is a DHT${partModel}`, detail: 'The two models encode their readings differently, so the library decodes nonsense (here: NaN).', fix: `Use DHT dht(${pin}, DHT${partModel});`, parts: [part.id] });
          return null;
        }
        const r = e.dhtRead({ id: 'sketch', kind: 'dht', part: part.id, model: partModel === 11 ? 'DHT11' : 'DHT22', pin }, true);
        return r.ok ? { temperature: r.temperature, humidity: r.humidity } : null;
      },
      tftFor: (pins) => {
        e.ensureSolved();
        const tfts = e.partsOf('tft');
        if (!tfts.length) { e.missing('an ST7735 TFT', 'The sketch draws on an ST7735 display.'); return null; }
        const spi = e.board.spiDefault;
        if (pins.mosi !== spi.mosi || pins.sck !== spi.sck) {
          e.note({ code: 'spi-software', severity: 'error', title: 'Software SPI pins are not simulated', detail: `The sketch uses MOSI = GPIO${pins.mosi}, SCK = GPIO${pins.sck}. ESP32 Lab simulates hardware SPI only (MOSI = GPIO${spi.mosi}, SCK = GPIO${spi.sck}).`, fix: 'Use the 3-argument constructor Adafruit_ST7735 tft(CS, DC, RST); and wire SDA → GPIO23, SCK → GPIO18.' });
          return null;
        }
        const b = { id: 'sketch', kind: 'tft' as const, part: '', cs: pins.cs, dc: pins.dc, rst: pins.rst };
        const part = tfts.find((p) => !e.spiProblem(p.id, { ...b, part: p.id })) ?? tfts[0];
        e.fwFns.set(spi.sck, 'SPI SCK'); e.fwFns.set(spi.mosi, 'SPI MOSI'); e.fwFns.set(pins.cs, 'TFT CS'); e.fwFns.set(pins.dc, 'TFT DC');
        if (pins.rst >= 0) e.fwFns.set(pins.rst, 'TFT RESET');
        const problem = e.spiProblem(part.id, { ...b, part: part.id });
        if (problem) { e.note(problem); return null; }
        e.clearIssuesFor(part.id, SPI_CODES);
        return e.states.get(part.id).fb as ColorFramebuffer;
      },
      warn: (code, title, detail, fix) => e.note({ code, severity: 'warning', title, detail, fix }),
      firmwareFault: (message, line) => e.firmwareFault(message, line),
      firmwareRestart: () => { e.log('(ESP.restart() called)', 'sys'); e.boot('SW_CPU_RESET'); },
    };
  }

  /** A runtime fault stops the sketch where it happened (a real board would print a backtrace and reboot). */
  private firmwareFault(message: string, line: number) {
    this.runner?.stop();
    this.fault = { message, line };
    this.log(`Guru Meditation Error: the sketch stopped at line ${line}`, 'err');
    this.log(message, 'err');
    this.log('(a real ESP32 would now print a backtrace and reboot; ESP32 Lab stops here so you can see why)', 'sys');
    this.firmware = 'crashed';
    this.pins.clear();
    this.note({ code: 'firmware-fault', severity: 'error', title: `The sketch crashed at line ${line}`, detail: message, fix: 'Fix the line in the Code tab and press Run again.' });
    this.invalidate();
    this.settle();
  }

  /** Logic level on a pin without side effects (null when nothing defines it). */
  pinLevel(pin: number): 0 | 1 | null {
    this.ensureSolved();
    const def = this.gpioDef(pin);
    if (!def) return null;
    const st = this.pins.get(pin);
    if (st?.mode === 'OUTPUT') return st.level;
    const net = this.netOfPin(def.id);
    if (!this.sol.driven.has(net)) return null;
    return this.sol.v[net] > 1.65 ? 1 : 0;
  }

  private pinFunction(gpio: number | undefined, st: PinRuntime | undefined) {
    if (gpio == null) return undefined;
    if (st?.servoUs != null) return 'Servo';
    if (st?.toneHz != null) return `tone ${Math.round(st.toneHz)} Hz`;
    if (st?.pwm != null && st.pwmHz) return `PWM ${st.pwmHz >= 1000 ? `${+(st.pwmHz / 1000).toFixed(2)} kHz` : `${Math.round(st.pwmHz)} Hz`}`;
    if (this.mode === 'code') return this.fwFns.get(gpio) ?? (gpio === 1 ? 'Serial TX' : gpio === 3 ? 'Serial RX' : undefined);
    const p = this.project.program;
    const usesI2c = p.devices.some((d) => d.kind === 'ssd1306' || d.kind === 'bme280');
    if (usesI2c && gpio === p.i2c.sda) return 'I²C SDA';
    if (usesI2c && gpio === p.i2c.scl) return 'I²C SCL';
    const tft = p.devices.find((d) => d.kind === 'tft') as Extract<DeviceBinding, { kind: 'tft' }> | undefined;
    if (tft) {
      if (gpio === this.board.spiDefault.sck) return 'SPI SCK';
      if (gpio === this.board.spiDefault.mosi) return 'SPI MOSI';
      if (gpio === tft.cs) return 'TFT CS';
      if (gpio === tft.dc) return 'TFT DC';
      if (gpio === tft.rst) return 'TFT RESET';
    }
    if (p.devices.some((d) => d.kind === 'dht' && d.pin === gpio)) return 'DHT data';
    if (gpio === 1) return 'Serial TX';
    if (gpio === 3) return 'Serial RX';
    return undefined;
  }
}

export interface CombinedSolution extends Solution {
  els: Element[];
  supplies: Map<string, number>;
  driven: Set<number>;
  weight: number | null;
}

const I2C_TYPES = ['ssd1306', 'bme280'];
const I2C_CODES = ['device-unpowered', 'i2c-swapped', 'i2c-not-wired', 'i2c-address', 'i2c-conflict'];
const SPI_CODES = ['device-unpowered', 'spi-not-wired', 'spi-reset-floating'];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
export const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
