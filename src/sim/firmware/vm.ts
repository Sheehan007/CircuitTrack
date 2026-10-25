/*
  Bytecode VM for compiled sketches.

  The program is a flat array of (op, a, b) triples. Threads (the Arduino loop task, and short-lived interrupt
  handlers) each have their own value stack and call frames and share the globals. run(thread, budget) executes at
  most `budget` instructions and returns why it stopped: out of budget (time slice used up), delay() (sleep), finished,
  or a runtime fault. Nothing here blocks, so the host can interleave the sketch with the circuit simulation.
*/
import { conv, KINDS, toText, type Kind, type NumKind } from './types';

export enum Op {
  CONST, LOADG, STOREG, LOADL, STOREL, POP, DUP, DUP2, IDXGET, IDXSET, BIN, CMP, NEG, BNOT, NOT, CONV, JMP, JZ, JNZ,
  CALL, RET, NATIVE, NEWARR, HALT, LOOPTICK, ARRLEN, STRIDX,
}

export const BIN_OPS = ['+', '-', '*', '/', '%', '<<', '>>', '&', '|', '^'] as const;
export const CMP_OPS = ['==', '!=', '<', '<=', '>', '>='] as const;

export interface FuncInfo { name: string; entry: number; nLocals: number; nParams: number; line: number; endLine: number; isVoid: boolean }
export interface CallSite { argc: number; kinds: Kind[]; pushes: boolean; line: number; extra?: unknown }

export interface Compiled {
  code: number[];
  lines: number[];
  consts: unknown[];
  funcs: FuncInfo[];
  nGlobals: number;
  globalNames: { name: string; slot: number; kind: Kind | 'obj' | 'arr' }[];
  sites: CallSite[];
  natives: NativeFn[];
  nativeNames: string[];
  /** Entry pc of the bootstrap: init globals → setup() → loop() forever. */
  boot: number;
  /** pc of a HALT used as the return address of interrupt handlers. */
  haltPc: number;
  funcIndex: Record<string, number>;
}

/** What a native can return besides a plain value. */
export class Sleep { constructor(public ms: number) {} }
export class Fault { constructor(public message: string) {} }
export class Restart {}

export type NativeFn = (vm: VM, args: unknown[], site: CallSite) => unknown;

interface Frame { fn: number; ret: number; locals: unknown[] }

export class Thread {
  stack: unknown[] = [];
  frames: Frame[] = [];
  pc: number;
  /** pc of the instruction the thread is "at" for the editor: the delay() it sleeps in, or where it was preempted. */
  atPc: number;
  done = false;
  constructor(pc: number, readonly isr = false) { this.pc = pc; this.atPc = pc; }
}

export type RunResult =
  | { kind: 'budget'; used: number }
  | { kind: 'sleep'; ms: number; used: number }
  | { kind: 'done'; used: number }
  | { kind: 'fault'; message: string; line: number; used: number }
  | { kind: 'restart'; used: number };

const MAX_FRAMES = 200;

export class VM {
  globals: unknown[];
  /** Host services (set by the runner); natives reach the simulator through it. */
  host: unknown = null;
  /** Instructions executed so far in the current slice (natives use it for the time cursor). */
  used = 0;
  current: Thread | null = null;

  constructor(readonly prog: Compiled) {
    this.globals = new Array(prog.nGlobals).fill(0);
  }

  mainThread() { return new Thread(this.prog.boot); }

  /** A thread that calls function `fn` (no arguments) and halts: used for interrupt handlers. */
  callThread(fn: number) {
    const t = new Thread(this.prog.funcs[fn].entry, true);
    t.frames.push({ fn, ret: this.prog.haltPc, locals: new Array(this.prog.funcs[fn].nLocals).fill(0) });
    return t;
  }

  lineOf(t: Thread) { return this.prog.lines[Math.max(0, Math.min(this.prog.lines.length - 1, t.atPc / 3))] ?? 0; }

  run(t: Thread, budget: number): RunResult {
    const { code, consts, funcs, sites, natives, lines } = this.prog;
    const g = this.globals;
    const st = t.stack;
    let pc = t.pc;
    let used = 0;
    // run() is re-entrant: an interrupt handler can run inside a native call of the main thread
    const outerThread = this.current, outerUsed = this.used;
    this.current = t;
    const frame = () => t.frames[t.frames.length - 1];
    const fault = (message: string): RunResult => { t.pc = pc - 3; t.atPc = pc - 3; return { kind: 'fault', message, line: lines[(pc - 3) / 3] ?? 0, used }; };
    try {
      while (used < budget) {
        const op = code[pc], a = code[pc + 1], b = code[pc + 2];
        pc += 3;
        used++;
        this.used = used;
        switch (op) {
          case Op.CONST: st.push(consts[a]); break;
          case Op.LOADG: st.push(g[a]); break;
          case Op.STOREG: g[a] = st.pop(); break;
          case Op.LOADL: st.push(frame().locals[a]); break;
          case Op.STOREL: frame().locals[a] = st.pop(); break;
          case Op.POP: st.pop(); break;
          case Op.DUP: st.push(st[st.length - 1]); break;
          case Op.DUP2: { const n = st.length; st.push(st[n - 2], st[n - 1]); break; }
          case Op.IDXGET: {
            const i = st.pop() as number, arr = st.pop() as unknown[];
            if (i < 0 || i >= arr.length || !Number.isInteger(i)) return fault(`Array index ${i} is out of bounds (the array has ${arr.length} elements). On a real ESP32 this reads random memory.`);
            st.push(arr[i]);
            break;
          }
          case Op.IDXSET: {
            const v = st.pop(), i = st.pop() as number, arr = st.pop() as unknown[];
            if (i < 0 || i >= arr.length || !Number.isInteger(i)) return fault(`Array index ${i} is out of bounds (the array has ${arr.length} elements). On a real ESP32 this corrupts memory.`);
            arr[i] = v;
            break;
          }
          case Op.STRIDX: {
            const i = st.pop() as number, s = st.pop() as string;
            st.push(i >= 0 && i < s.length ? s.charCodeAt(i) & 0xff : 0);
            break;
          }
          case Op.ARRLEN: st.push((st.pop() as unknown[]).length); break;
          case Op.BIN: {
            const y = st.pop(), x = st.pop();
            const r = binop(a, KINDS[b], x, y);
            if (r instanceof Fault) return fault(r.message);
            st.push(r);
            break;
          }
          case Op.CMP: {
            const y = st.pop() as number, x = st.pop() as number;
            let r: boolean;
            switch (a) { case 0: r = x === y; break; case 1: r = x !== y; break; case 2: r = x < y; break; case 3: r = x <= y; break; case 4: r = x > y; break; default: r = x >= y; }
            st.push(r ? 1 : 0);
            break;
          }
          case Op.NEG: st.push(conv(-(st.pop() as number), KINDS[a] as NumKind)); break;
          case Op.BNOT: st.push(conv(~(st.pop() as number), KINDS[a] as NumKind)); break;
          case Op.NOT: st.push(st.pop() ? 0 : 1); break;
          case Op.CONV: {
            const from = KINDS[a], to = KINDS[b];
            const v = st.pop();
            if (to === 'str') st.push(toText(v, from));
            else st.push(conv(v as number, to as NumKind));
            break;
          }
          case Op.JMP: pc = a; break;
          case Op.JZ: if (!st.pop()) pc = a; break;
          case Op.JNZ: if (st.pop()) pc = a; break;
          case Op.CALL: {
            if (t.frames.length >= MAX_FRAMES) return fault(`Stack overflow: too many nested calls (is ${funcs[a].name}() calling itself forever?).`);
            const f = funcs[a];
            const locals = new Array(f.nLocals).fill(0);
            for (let k = b - 1; k >= 0; k--) locals[k] = st.pop();
            t.frames.push({ fn: a, ret: pc, locals });
            pc = f.entry;
            break;
          }
          case Op.RET: {
            const fr = t.frames.pop()!;
            pc = fr.ret;
            if (pc === this.prog.haltPc && t.isr) { if (a) st.pop(); }
            break;
          }
          case Op.NATIVE: {
            const site = sites[b];
            const args = st.splice(st.length - site.argc, site.argc);
            t.pc = pc;
            const r = natives[a](this, args, site);
            if (r instanceof Sleep) {
              if (t.isr) return fault('delay() inside an interrupt handler: an ISR must return quickly (the real ESP32 would crash).');
              t.pc = pc;
              t.atPc = pc - 3;
              return { kind: 'sleep', ms: r.ms, used };
            }
            if (r instanceof Fault) return fault(r.message);
            if (r instanceof Restart) { t.pc = pc; return { kind: 'restart', used }; }
            if (site.pushes) st.push(r);
            break;
          }
          case Op.NEWARR: {
            const fill = KINDS[b] === 'str' ? '' : 0;
            st.push(new Array(a).fill(fill));
            break;
          }
          case Op.LOOPTICK: break;
          case Op.HALT: t.pc = pc - 3; t.done = true; return { kind: 'done', used };
          default: return fault(`Internal VM error: unknown opcode ${op}.`);
        }
      }
      t.pc = pc;
      t.atPc = pc;
      return { kind: 'budget', used };
    } finally {
      this.current = outerThread;
      this.used = outerUsed;
    }
  }
}

function binop(op: number, kind: Kind, x: unknown, y: unknown): unknown {
  if (kind === 'str') return String(x) + String(y);
  const a = x as number, b = y as number;
  const div0 = () => new Fault('Division by zero. The real ESP32 stops with "Guru Meditation Error: IntegerDivideByZero".');
  switch (kind) {
    case 'i32':
      switch (op) {
        case 0: return (a + b) | 0;
        case 1: return (a - b) | 0;
        case 2: return Math.imul(a, b);
        case 3: return b === 0 ? div0() : (a / b) | 0;
        case 4: return b === 0 ? div0() : (a % b) | 0;
        case 5: return a << (b & 31);
        case 6: return a >> (b & 31);
        case 7: return a & b;
        case 8: return a | b;
        default: return a ^ b;
      }
    case 'u32':
      switch (op) {
        case 0: return (a + b) >>> 0;
        case 1: return (a - b) >>> 0;
        case 2: return Math.imul(a, b) >>> 0;
        case 3: return b === 0 ? div0() : Math.floor(a / b) >>> 0;
        case 4: return b === 0 ? div0() : (a % b) >>> 0;
        case 5: return (a << (b & 31)) >>> 0;
        case 6: return a >>> (b & 31);
        case 7: return (a & b) >>> 0;
        case 8: return (a | b) >>> 0;
        default: return (a ^ b) >>> 0;
      }
    case 'f32':
    case 'f64': {
      let r: number;
      switch (op) {
        case 0: r = a + b; break;
        case 1: r = a - b; break;
        case 2: r = a * b; break;
        case 3: r = a / b; break;
        default: return new Fault('Bit and % operators need integers.');
      }
      return kind === 'f32' ? Math.fround(r) : r;
    }
    default: {
      // 64-bit kinds: JS precision (exact up to 2^53)
      switch (op) {
        case 0: return a + b;
        case 1: return a - b;
        case 2: return a * b;
        case 3: return b === 0 ? div0() : Math.trunc(a / b);
        case 4: return b === 0 ? div0() : a % b;
        case 5: return a * Math.pow(2, b);
        case 6: return Math.floor(a / Math.pow(2, b));
        case 7: return Number(BigInt(Math.trunc(a)) & BigInt(Math.trunc(b)));
        case 8: return Number(BigInt(Math.trunc(a)) | BigInt(Math.trunc(b)));
        default: return Number(BigInt(Math.trunc(a)) ^ BigInt(Math.trunc(b)));
      }
    }
  }
}
