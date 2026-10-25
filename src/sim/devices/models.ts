/*
  Device models: the runtime side of each part type. A model owns the part's state (a display's framebuffer, a
  servo's angle, a motor's speed), advances it on the virtual clock (tick), and reports readings and visual state.
  The electrical side lives in the component definitions; both use the same engine (DeviceHost) underneath.
*/
import type { BoardProfile, PinDef } from '../boards/types';
import { LED_COLORS } from '../components/basic';
import { BATTERIES } from '../components/actuators';
import { ldrOhms } from '../components/inputs';
import type { PinRuntime } from '../engine';
import type { PartInstance, Issue } from '../types';
import { ColorFramebuffer } from './colorFramebuffer';
import { MonoFramebuffer } from './framebuffer';

export interface DeviceHost {
  board: BoardProfile;
  now(): number;
  /** Voltage at a part's terminal (NaN when nothing drives it). */
  termVolts(partId: string, term: string): number;
  /** Current through a solver element in amps. */
  current(id: string): number;
  /** VCC − GND for powered parts (0 if either side is floating), null if the part has no supply pins. */
  supply(partId: string): number | null;
  /** Board pins on the same net as a part terminal. */
  boardPinsAt(partId: string, term: string): PinDef[];
  pin(gpio: number): PinRuntime | undefined;
  input(partId: string, key: string): unknown;
  /** Re-solve the circuit (call when state that feeds the electrical model changed). */
  invalidate(): void;
  note(issue: Issue): void;
}

export interface PartView {
  powered?: boolean;
  supplyV?: number;
  readings: [string, string][];
  visual: Record<string, unknown>;
}

export interface PartModel<S = any> {
  init(part: PartInstance): S;
  /** Continuous behaviour, every TICK_MS of virtual time. */
  tick?(part: PartInstance, s: S, dtMs: number, h: DeviceHost, params: Record<string, any>): void;
  view(part: PartInstance, s: S, h: DeviceHost, params: Record<string, any>): PartView;
}

export const TICK_MS = 20;
const ma = (amps: number) => amps * 1000;
const fmtV = (v: number) => (Number.isNaN(v) ? 'floating' : `${v.toFixed(2)} V`);
const ledLevel = (milliamps: number) => (milliamps <= 0.05 ? 0 : Math.min(1, Math.pow(milliamps / 15, 0.55)));

const powerView = (h: DeviceHost, id: string, minV: number) => {
  const supplyV = h.supply(id) ?? 0;
  return { supplyV, powered: supplyV >= minV };
};

/** The GPIO driving a terminal, if any. */
const drivingPin = (h: DeviceHost, id: string, term: string) => h.boardPinsAt(id, term).find((p) => p.gpio != null);

export const MODELS: Record<string, PartModel> = {
  led: {
    init: () => ({}),
    view: (p, _s, h) => {
      const m = ma(h.current(`${p.id}.d`));
      const b = ledLevel(m);
      const va = h.termVolts(p.id, 'A'), vk = h.termVolts(p.id, 'K');
      const across = Number.isNaN(va) && Number.isNaN(vk) ? 'not connected'
        : Number.isNaN(va) || Number.isNaN(vk) ? `open circuit: the ${Number.isNaN(va) ? 'anode' : 'cathode'} side goes nowhere`
        : `${(va - vk).toFixed(2)} V (A ${va.toFixed(2)} V, K ${vk.toFixed(2)} V)`;
      return { readings: [['Current', `${m.toFixed(1)} mA`], ['Across the LED', across], ['Brightness', `${Math.round(b * 100)} %`]], visual: { brightness: b, ma: m, over: m > 30 } };
    },
  },

  rgb: {
    init: () => ({}),
    view: (p, _s, h) => {
      const m = (['r', 'g', 'b'] as const).map((c) => ma(h.current(`${p.id}.${c}`)));
      const lv = m.map(ledLevel);
      return {
        readings: [['Red', `${m[0].toFixed(1)} mA`], ['Green', `${m[1].toFixed(1)} mA`], ['Blue', `${m[2].toFixed(1)} mA`]],
        visual: { r: lv[0], g: lv[1], b: lv[2] },
      };
    },
  },

  resistor: {
    init: () => ({}),
    view: (p, _s, h, params) => {
      const m = ma(h.current(`${p.id}.r`));
      const v1 = h.termVolts(p.id, '1'), v2 = h.termVolts(p.id, '2');
      const drop = Math.abs(v1 - v2) || 0;
      const ohms = Number(params.ohms);
      const [hi, lo] = v1 >= v2 ? [v1, v2] : [v2, v1];
      // Ohm's law with the live values: for GPIO → R → LED this is I = (V_GPIO − V_LED) / R
      const law = Number.isNaN(v1) || Number.isNaN(v2) ? 'no current path' : `(${hi.toFixed(2)} V − ${lo.toFixed(2)} V) ÷ ${ohms >= 1000 ? `${+(ohms / 1000).toFixed(2)} kΩ` : `${ohms} Ω`} = ${(((hi - lo) / ohms) * 1000).toFixed(2)} mA`;
      return { readings: [['Current', `${Math.abs(m).toFixed(2)} mA`], ['Ohm\'s law', law], ['Voltage drop', `${drop.toFixed(2)} V`], ['Power', `${(Math.abs(m) * drop).toFixed(1)} mW`]], visual: { ma: m } };
    },
  },

  button: {
    init: () => ({}),
    view: (p, _s, h) => {
      const pressed = !!h.input(p.id, 'pressed');
      return { readings: [['State', pressed ? 'pressed (closed)' : 'released (open)']], visual: { pressed } };
    },
  },

  pot: {
    init: () => ({}),
    view: (p, _s, h, params) => ({
      readings: [['Position', `${Math.round(Number(params.position))} %`], ['Wiper', fmtV(h.termVolts(p.id, 'W'))]],
      visual: { position: Number(params.position) / 100 },
    }),
  },

  ldr: {
    init: () => ({}),
    view: (p, _s, h, params) => ({
      readings: [['Light', `${params.lux} lux`], ['Resistance', `${(ldrOhms(Number(params.lux)) / 1000).toFixed(1)} kΩ`], ['Current', `${Math.abs(ma(h.current(`${p.id}.r`))).toFixed(3)} mA`]],
      visual: { lux: Number(params.lux) },
    }),
  },

  pir: {
    init: () => ({ out: false, lastMotion: -Infinity }),
    tick: (p, s, _dt, h, params) => {
      const powered = (h.supply(p.id) ?? 0) >= 4.5;
      const hold = Number(params.holdMs ?? 3000);
      if (h.input(p.id, 'motion') && powered) s.lastMotion = h.now();
      const out = powered && h.now() - s.lastMotion < hold;
      if (out !== s.out) { s.out = out; h.invalidate(); }
    },
    view: (p, s, h) => {
      const pw = powerView(h, p.id, 4.5);
      return { ...pw, readings: [['Supply', `${pw.supplyV.toFixed(2)} V`], ['OUT', s.out ? 'HIGH (motion)' : 'LOW'], ['You', h.input(p.id, 'motion') ? 'moving' : 'still']], visual: { out: s.out, powered: pw.powered } };
    },
  },

  dht22: { init: () => ({ lastReadAt: null }), view: (p, s, h, params) => dhtView(p, s, h, params) },
  dht11: { init: () => ({ lastReadAt: null }), view: (p, s, h, params) => dhtView(p, s, h, params) },

  ssd1306: {
    init: () => ({ fb: new MonoFramebuffer(128, 64) }),
    view: (p, s, h, params) => {
      const pw = powerView(h, p.id, 3.0);
      return { ...pw, readings: [['Supply', `${pw.supplyV.toFixed(2)} V`], ['Address', `0x${Number(params.address).toString(16).toUpperCase()}`], ['Lit pixels', String(s.fb.litCount())]], visual: { powered: pw.powered, frame: s.fb.frame, pixels: s.fb.shown, tint: params.tint } };
    },
  },

  bme280: {
    init: () => ({ last: null }),
    view: (p, s, h, params) => {
      const pw = powerView(h, p.id, 1.71);
      const last = s.last as { temperature: number; humidity: number; pressure: number } | null;
      return { ...pw, readings: [['Supply', `${pw.supplyV.toFixed(2)} V`], ['Air', `${params.temperature} °C, ${params.humidity} %RH, ${params.pressure} hPa`], ['Last reading', last ? `${last.temperature} °C, ${last.humidity} %, ${last.pressure} hPa` : '—']], visual: { powered: pw.powered } };
    },
  },

  st7735: {
    init: () => ({ fb: new ColorFramebuffer(128, 160) }),
    view: (p, s, h) => {
      const pw = powerView(h, p.id, 3.0);
      const bl = Math.max(0, Math.min(1, (h.termVolts(p.id, 'LED') - (h.termVolts(p.id, 'GND') || 0)) / 3.0)) || 0;
      return { ...pw, readings: [['Supply', `${pw.supplyV.toFixed(2)} V`], ['Backlight', bl > 0.6 ? 'on' : bl > 0.05 ? `dim (${Math.round(bl * 100)} %)` : 'off']], visual: { powered: pw.powered, backlight: pw.powered ? bl : 0, frame: s.fb.frame, pixels: s.fb.shown } };
    },
  },

  servo: {
    init: () => ({ angle: 90, target: 90, moving: false, us: null as number | null }),
    tick: (p, s, dt, h) => {
      const v = h.supply(p.id) ?? 0;
      const pin = drivingPin(h, p.id, 'SIG');
      const rt = pin?.gpio != null ? h.pin(pin.gpio) : undefined;
      s.us = rt?.servoUs ?? null;
      if (s.us != null && v >= 4.0) s.target = Math.max(0, Math.min(180, ((s.us - 544) / (2400 - 544)) * 180));
      // SG90: 0.1 s per 60° at 4.8 V, slower on a lower supply; nothing moves without power or a pulse
      const speed = v >= 4.0 ? (60 / 100) * Math.min(1.25, v / 4.8) : 0;
      const step = speed * dt;
      const d = s.target - s.angle;
      const moving = Math.abs(d) > 0.3 && speed > 0;
      s.angle = moving ? s.angle + Math.sign(d) * Math.min(Math.abs(d), step) : s.angle;
      if (moving !== s.moving) { s.moving = moving; h.invalidate(); }
    },
    view: (p, s, h) => {
      const pw = powerView(h, p.id, 4.0);
      return { ...pw, readings: [['Supply', `${pw.supplyV.toFixed(2)} V`], ['Pulse', s.us != null ? `${Math.round(s.us)} µs` : 'none'], ['Angle', `${Math.round(s.angle)}° (target ${Math.round(s.target)}°)`]], visual: { angle: s.angle, moving: s.moving } };
    },
  },

  dcmotor: {
    init: () => ({ rpm: 0, angle: 0 }),
    tick: (p, s, dt, h, params) => {
      const v = (h.termVolts(p.id, 'M1') || 0) - (h.termVolts(p.id, 'M2') || 0);
      const lf = Math.max(0.12, Number(params.load ?? 20) / 100);
      const target = 200 * (v / 6) * (1 - lf) / 0.88;
      s.rpm += (target - s.rpm) * Math.min(1, dt / 150);
      if (Math.abs(s.rpm) < 0.5 && Math.abs(target) < 0.5) s.rpm = 0;
      s.angle = (s.angle + s.rpm * 6 * (dt / 1000)) % 360;
    },
    view: (p, s, h) => {
      const amps = h.current(`${p.id}.coil`);
      const v = (h.termVolts(p.id, 'M1') || 0) - (h.termVolts(p.id, 'M2') || 0);
      return { readings: [['Voltage', `${v.toFixed(2)} V`], ['Current', `${Math.abs(ma(amps)).toFixed(0)} mA`], ['Speed', `${Math.round(Math.abs(s.rpm))} rpm ${s.rpm > 1 ? '↻' : s.rpm < -1 ? '↺' : ''}`]], visual: { rpm: s.rpm, angle: s.angle } };
    },
  },

  l298n: {
    init: () => ({}),
    view: (p, _s, h) => {
      const g = h.termVolts(p.id, 'GND') || 0;
      const vs = (h.termVolts(p.id, 'VS') || 0) - g;
      const hi = (t: string) => (h.termVolts(p.id, t) || 0) - g > 2.3;
      const ch = (en: string, a: string, b: string) => !hi(en) ? 'off (coasting)' : hi(a) === hi(b) ? 'brake' : hi(a) ? 'forward' : 'reverse';
      return { readings: [['Motor supply', `${vs.toFixed(1)} V`], ['Motor A', ch('ENA', 'IN1', 'IN2')], ['Motor B', ch('ENB', 'IN3', 'IN4')]], visual: { a: ch('ENA', 'IN1', 'IN2'), b: ch('ENB', 'IN3', 'IN4'), powered: vs > 4.5 } };
    },
  },

  battery: {
    init: () => ({}),
    view: (p, _s, h, params) => {
      const b = BATTERIES[params.kind] ?? BATTERIES.aa4;
      const amps = h.current(`${p.id}.cells`);
      return { readings: [['Pack', b.label], ['Delivering', `${Math.abs(ma(amps)).toFixed(0)} mA`]], visual: { kind: params.kind } };
    },
  },

  'buzzer-active': {
    init: () => ({}),
    view: (p, _s, h) => {
      const v = (h.termVolts(p.id, 'P') || 0) - (h.termVolts(p.id, 'N') || 0);
      const sounding = v > 2.0;
      return { readings: [['Voltage', `${v.toFixed(2)} V`], ['Sound', sounding ? 'beeping, ~2.3 kHz' : 'silent']], visual: { sounding, hz: sounding ? 2300 : 0 } };
    },
  },

  'buzzer-passive': {
    init: () => ({}),
    view: (p, _s, h) => {
      const pin = drivingPin(h, p.id, 'P');
      const rt = pin?.gpio != null ? h.pin(pin.gpio) : undefined;
      const grounded = h.boardPinsAt(p.id, 'N').some((q) => q.kind === 'ground');
      // tone() or LEDC PWM (ledcWrite / analogWrite) both make a square wave the buzzer turns into sound
      const wave = rt?.toneHz ?? (rt?.mode === 'OUTPUT' && rt.pwm != null && rt.pwmHz ? rt.pwmHz : 0);
      const hz = wave && grounded ? wave : 0;
      const dc = !hz && rt?.mode === 'OUTPUT' && rt.level === 1 && rt.pwm == null;
      return { readings: [['Sound', hz ? `${Math.round(hz)} Hz` : dc ? 'silent (steady HIGH only clicks: use tone())' : 'silent']], visual: { sounding: hz > 0, hz } };
    },
  },
};

function dhtView(p: PartInstance, s: { last?: { temperature: number; humidity: number } }, h: DeviceHost, params: Record<string, any>): PartView {
  const pw = powerView(h, p.id, 3.0);
  return { ...pw, readings: [['Supply', `${pw.supplyV.toFixed(2)} V`], ['Air', `${params.temperature} °C, ${params.humidity} %RH`], ['Last reading', s.last ? `${s.last.temperature} °C, ${s.last.humidity} %RH` : '—']], visual: { powered: pw.powered, reading: !!s.last } };
}

export const ledColorHex = (c: string) => (LED_COLORS[c] ?? LED_COLORS.red).hex;
