import type { Hal } from '../hal';
import { builtinSprite, customSprite } from '../devices/sprites';
import type { Action, Condition, Program, Rule, Value } from './types';

/**
 * Runs a behaviour program against the HAL. Rules fire on start, on timers, or on edges seen on input pins. Every
 * action is instantaneous; ordering is fixed by the virtual clock's queue, so runs are reproducible.
 */
export class ProgramRunner {
  vars = new Map<string, number>();
  private timers: { cancel(): void }[] = [];
  private lastRead = new Map<number, 0 | 1>();
  private running = false;

  constructor(private program: Program, private hal: Hal) {}

  start() {
    this.running = true;
    const p = this.program;
    for (const [pin, mode] of Object.entries(p.pins)) this.hal.pinMode(Number(pin), mode);
    for (const d of p.devices) if (d.kind === 'dht') this.hal.pinMode(d.pin, 'INPUT_PULLUP');
    for (const v of p.vars) this.vars.set(v.name, v.initial);
    for (const v of this.referencedVars()) if (!this.vars.has(v)) this.vars.set(v, 0);
    // devices that need set-up: an OLED starts cleared, as after display.begin() + clearDisplay()
    for (const d of p.devices) if (d.kind === 'ssd1306') this.hal.oledDraw(d, (fb) => fb.clear());
    for (const d of p.devices) if (d.kind === 'tft') this.hal.tftDraw(d, (fb) => fb.fill('#000000'));
    for (const pin of this.watchedPins()) this.lastRead.set(pin, this.hal.digitalRead(pin));
    const t0 = this.hal.now();
    for (const r of p.rules) {
      if (!r.enabled) continue;
      if (r.trigger.kind === 'start') this.timers.push(this.hal.schedule(t0, () => this.fire(r)));
      if (r.trigger.kind === 'every') {
        const ms = Math.max(10, r.trigger.ms);
        const first = r.trigger.immediate ? t0 : t0 + ms;
        const tick = (at: number) => {
          this.timers.push(this.hal.schedule(at, () => { if (!this.running) return; this.fire(r); tick(at + ms); }));
        };
        tick(first);
      }
    }
  }

  stop() {
    this.running = false;
    for (const t of this.timers) t.cancel();
    this.timers = [];
  }

  watchedPins(): number[] {
    const pins = new Set<number>();
    for (const r of this.program.rules) if (r.enabled && r.trigger.kind === 'pinEdge') pins.add(r.trigger.pin);
    return [...pins];
  }

  /** Called by the engine whenever the circuit settles: fires edge rules on watched pins. */
  onInputsChanged() {
    if (!this.running) return;
    for (const pin of this.watchedPins()) {
      const now = this.hal.digitalRead(pin);
      const before = this.lastRead.get(pin) ?? now;
      if (now === before) continue;
      this.lastRead.set(pin, now);
      for (const r of this.program.rules) {
        if (!r.enabled || r.trigger.kind !== 'pinEdge' || r.trigger.pin !== pin) continue;
        const e = r.trigger.edge;
        if (e === 'change' || (e === 'rising' && now === 1) || (e === 'falling' && now === 0)) {
          this.hal.schedule(this.hal.now(), () => this.fire(r));
        }
      }
    }
  }

  fire(rule: Rule) {
    if (!this.running) return;
    this.hal.markActive(rule.id);
    const branch = rule.conditions.every((c) => this.test(c)) ? rule.actions : rule.elseActions;
    for (const a of branch) {
      if (!this.running) return;
      this.exec(a, rule);
    }
  }

  private test(c: Condition) {
    const l = this.value(c.left), r = this.value(c.right);
    switch (c.op) {
      case '==': return l === r;
      case '!=': return l !== r;
      case '<': return l < r;
      case '<=': return l <= r;
      case '>': return l > r;
      case '>=': return l >= r;
    }
  }

  value(v: Value): number {
    switch (v.kind) {
      case 'num': return v.value;
      case 'var': return this.vars.get(v.name) ?? 0;
      case 'digitalRead': return this.hal.digitalRead(v.pin);
      case 'analogRead': return this.hal.analogRead(v.pin);
      case 'millis': return this.hal.millis();
      case 'random': return Math.floor(v.min + this.hal.random() * (v.max - v.min + 1));
      case 'feed': return this.hal.feed(v.feed);
      case 'listLen': return this.program.lists?.[v.list]?.length ?? 0;
      case 'map': {
        const x = this.value(v.value);
        if (v.inMax === v.inMin) return v.outMin;
        return Math.trunc(((x - v.inMin) * (v.outMax - v.outMin)) / (v.inMax - v.inMin) + v.outMin);
      }
    }
  }

  private exec(a: Action, rule: Rule) {
    this.hal.markActive(rule.id, a.id);
    switch (a.kind) {
      case 'digitalWrite': {
        const level = a.value === 'TOGGLE' ? (this.hal.outputLevel(a.pin) ? 0 : 1) : a.value === 'HIGH' ? 1 : 0;
        this.hal.digitalWrite(a.pin, level);
        break;
      }
      case 'pwmWrite':
        this.hal.analogWrite(a.pin, Math.max(0, Math.min(255, Math.round(this.value(a.duty)))));
        break;
      case 'setVar': {
        const v = this.value(a.value);
        this.vars.set(a.name, a.op === 'add' ? (this.vars.get(a.name) ?? 0) + v : v);
        break;
      }
      case 'readDht': {
        const d = this.program.devices.find((x) => x.id === a.device);
        if (!d || d.kind !== 'dht') { this.hal.serialPrintln(`[behaviour] no DHT device "${a.device}"`); break; }
        const r = this.hal.dhtRead(d);
        if (r.ok) { this.vars.set(a.temp, r.temperature); this.vars.set(a.hum, r.humidity); }
        else { this.vars.set(a.temp, NaN); this.vars.set(a.hum, NaN); }
        break;
      }
      case 'oledClear':
      case 'oledText': {
        const d = this.program.devices.find((x) => x.id === a.device);
        if (!d || d.kind !== 'ssd1306') { this.hal.serialPrintln(`[behaviour] no OLED device "${a.device}"`); break; }
        this.hal.oledDraw(d, (fb) => {
          if (a.kind === 'oledClear') fb.clear();
          else fb.text(a.x, a.y, this.format(a.text), a.size);
        });
        break;
      }
      case 'serialPrint':
        this.hal.serialPrintln(this.format(a.text));
        break;
      case 'servoWrite':
        this.hal.servoWrite(a.pin, Math.max(0, Math.min(180, this.value(a.angle))));
        break;
      case 'tone':
        this.hal.tone(a.pin, Math.max(1, this.value(a.freq)), a.ms);
        break;
      case 'noTone':
        this.hal.noTone(a.pin);
        break;
      case 'readBme': {
        const d = this.program.devices.find((x) => x.id === a.device);
        if (!d || d.kind !== 'bme280') { this.hal.serialPrintln(`[behaviour] no BME280 device "${a.device}"`); break; }
        const r = this.hal.bmeRead(d);
        this.vars.set(a.temp, r.ok ? r.temperature : NaN);
        this.vars.set(a.hum, r.ok ? r.humidity : NaN);
        this.vars.set(a.pres, r.ok ? r.pressure : NaN);
        break;
      }
      case 'tftFill': case 'tftText': case 'tftRect': case 'tftCircle': case 'tftSprite': case 'tftBar': {
        const d = this.program.devices.find((x) => x.id === a.device);
        if (!d || d.kind !== 'tft') { this.hal.serialPrintln(`[behaviour] no TFT device "${a.device}"`); break; }
        this.hal.tftDraw(d, (fb) => {
          if (a.kind === 'tftFill') fb.fill(a.color);
          else if (a.kind === 'tftText') fb.text(a.x, a.y, this.format(a.text), a.size, a.color);
          else if (a.kind === 'tftRect') a.fill ? fb.fillRect(a.x, a.y, a.w, a.h, a.color) : fb.rect(a.x, a.y, a.w, a.h, a.color);
          else if (a.kind === 'tftCircle') fb.circle(a.x, a.y, a.r, a.color, a.fill);
          else if (a.kind === 'tftBar') {
            const k = Math.max(0, Math.min(1, this.value(a.value) / (a.max || 1)));
            fb.rect(a.x, a.y, a.w, a.h, a.color);
            fb.fillRect(a.x + 1, a.y + 1, a.w - 2, a.h - 2, '#000000');
            fb.fillRect(a.x + 1, a.y + 1, Math.round((a.w - 2) * k), a.h - 2, a.color);
          } else {
            const custom = this.program.sprites?.[a.sprite];
            const sp = custom ? customSprite(custom) : builtinSprite(a.sprite);
            if (sp) fb.sprite(sp, a.x, a.y, a.scale);
          }
        });
        break;
      }
    }
  }

  /** "{temp:1} C" → value of temp with one decimal; "{lyrics[i]}" → line i of a text list. NaN prints as "nan". */
  format(text: string) {
    text = text.replace(/\{([a-zA-Z_]\w*)\[([a-zA-Z_]\w*|\d+)\]\}/g, (_, list: string, idx: string) => {
      const lines = this.program.lists?.[list];
      if (!lines?.length) return '?';
      const i = /^\d+$/.test(idx) ? Number(idx) : Math.floor(this.vars.get(idx) ?? 0);
      return lines[((i % lines.length) + lines.length) % lines.length];
    });
    return text.replace(/\{([a-zA-Z_][\w]*)(?::(\d))?\}/g, (_, name: string, dec?: string) => {
      if (name === 'millis') return String(Math.round(this.hal.millis()));
      const v = this.vars.get(name);
      if (v == null) return '?';
      if (Number.isNaN(v)) return 'nan';
      return dec != null ? v.toFixed(Number(dec)) : String(Math.round(v * 100) / 100);
    });
  }

  private referencedVars() {
    const out = new Set<string>();
    const scan = (v: Value) => { if (v.kind === 'var') out.add(v.name); };
    for (const r of this.program.rules) {
      for (const c of r.conditions) { scan(c.left); scan(c.right); }
      for (const a of [...r.actions, ...r.elseActions]) {
        if (a.kind === 'setVar') { out.add(a.name); scan(a.value); }
        if (a.kind === 'readDht') { out.add(a.temp); out.add(a.hum); }
        if (a.kind === 'readBme') { out.add(a.temp); out.add(a.hum); out.add(a.pres); }
        if (a.kind === 'pwmWrite') scan(a.duty);
        if (a.kind === 'servoWrite') scan(a.angle);
        if (a.kind === 'tone') scan(a.freq);
        if (a.kind === 'tftBar') scan(a.value);
      }
    }
    return out;
  }
}
