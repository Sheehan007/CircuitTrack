/*
  Compiler for the Arduino-C++ subset: preprocess → parse → check & generate bytecode for the VM.

  It is a real compiler for a defined subset, not a pattern matcher: names are resolved in scopes, every expression is
  typed with C rules (integer division, wrap-around, signed/unsigned comparisons, float promotion), library calls are
  checked against their signatures, and anything outside the subset is an error with a line number and a reason.
*/
import type { Declarator, Expr, FuncDecl, GlobalDecl, Stmt, TypeSpec } from './ast';
import { CompileError, type Diagnostic } from './diagnostics';
import { preprocess } from './lexer';
import { parse } from './parser';
import { CLASSES, CONSTANTS, FUNCTIONS, GLOBAL_OBJECTS, HEADERS, STATICS, STRING_METHODS, unsupportedFunction, type NativeSpec } from './runtime';
import { arith, BASE_TYPES, isFloat, isNum, KI, kindOf, SIZEOF, T, toText, typeName, type CType, type Kind, type NumKind } from './types';
import { BIN_OPS, CMP_OPS, Op, type CallSite, type Compiled, type FuncInfo, type NativeFn } from './vm';

export interface CompileResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  program?: Compiled;
  /** Libraries the sketch includes (for the UI). */
  includes: string[];
}

interface VarInfo { slot: number; type: CType; isConst: boolean; global: boolean; name: string; constValue?: number }
interface UserFunc { index: number; decl: FuncDecl; ret: CType; params: CType[] }

const err = (pos: { line: number; col: number }, message: string): never => { throw new CompileError({ line: pos.line, col: pos.col, severity: 'error', message }); };

export function compileSketch(source: string): CompileResult {
  const diags: Diagnostic[] = [];
  const { tokens, includes } = preprocess(source, diags);
  const included = new Set<string>(['Arduino.h']);
  for (const inc of includes) {
    const h = HEADERS[inc.name];
    if (h === undefined) diags.push({ line: inc.line, col: 1, severity: 'error', message: `<${inc.name}> is not available in ESP32 Lab. Supported: Wire.h, SPI.h, Adafruit_GFX.h, Adafruit_SSD1306.h, Adafruit_ST7735.h, Adafruit_BME280.h, DHT.h, ESP32Servo.h.` });
    else if (h) diags.push({ line: inc.line, col: 1, severity: 'error', message: `<${inc.name}>: ${h}` });
    else included.add(inc.name);
  }
  const classNames = new Set(Object.keys(CLASSES).filter((c) => !['HardwareSerial', 'TwoWire', 'EspClass'].includes(c)));
  const ast = parse(tokens, classNames, diags);
  const result: CompileResult = { ok: false, diagnostics: diags, includes: includes.map((i) => i.name) };
  if (diags.some((d) => d.severity === 'error')) return result;
  try {
    const program = new Gen(ast.items, included, diags).run();
    result.program = program;
  } catch (e) {
    if (e instanceof CompileError) diags.push(e.diag); else throw e;
  }
  diags.sort((a, b) => a.line - b.line);
  result.ok = !diags.some((d) => d.severity === 'error') && !!result.program;
  if (!result.ok) result.program = undefined;
  return result;
}

/* ====================================================================================== */

class Gen {
  code: number[] = [];
  lines: number[] = [];
  consts: unknown[] = [];
  constIndex = new Map<unknown, number>();
  sites: CallSite[] = [];
  natives: NativeFn[] = [];
  nativeNames: string[] = [];
  nativeIndex = new Map<string, number>();
  funcs: FuncInfo[] = [];
  userFuncs = new Map<string, UserFunc>();
  globals = new Map<string, VarInfo>();
  nGlobals = 0;
  /** Code that initialises globals and static locals, emitted as a function after everything else. */
  initThunks: (() => void)[] = [];
  line = 0;
  // per-function state
  scopes: Map<string, VarInfo>[] = [];
  nLocals = 0;
  fnRet: CType = T.void;
  fnName = '';
  loops: { breaks: number[]; continues: number[]; isSwitch: boolean }[] = [];

  constructor(private items: (FuncDecl | GlobalDecl)[], private included: Set<string>, private diags: Diagnostic[]) {}

  warn(pos: { line: number; col: number }, message: string) { this.diags.push({ line: pos.line, col: pos.col, severity: 'warning', message }); }

  /* ---------------- emit helpers ---------------- */

  emit(op: Op, a = 0, b = 0) { this.code.push(op, a, b); this.lines.push(this.line); return this.code.length - 3; }
  here() { return this.code.length; }
  patch(at: number, target: number) { this.code[at + 1] = target; }
  constOf(v: unknown) {
    const key = typeof v === 'number' && Object.is(v, -0) ? 'neg0' : v;
    let i = this.constIndex.get(key);
    if (i == null) { i = this.consts.length; this.consts.push(v); this.constIndex.set(key, i); }
    return i;
  }
  pushConst(v: unknown) { this.emit(Op.CONST, this.constOf(v)); }
  native(name: string, fn: NativeFn) {
    let i = this.nativeIndex.get(name);
    if (i == null) { i = this.natives.length; this.natives.push(fn); this.nativeNames.push(name); this.nativeIndex.set(name, i); }
    return i;
  }

  /* ---------------- types ---------------- */

  resolveType(ts: TypeSpec): CType {
    if (ts.ptr) {
      if (ts.base === 'char' && ts.ptr === 1) return T.cstr;
      return err(ts, `Pointers (${ts.base}${'*'.repeat(ts.ptr)}) are not supported. Use const char* for text, or String.`);
    }
    const t = BASE_TYPES[ts.base];
    if (t) return t;
    const cls = CLASSES[ts.base];
    if (cls) {
      if (!this.included.has(cls.header)) err(ts, `${ts.base} needs #include <${cls.header}> at the top of the sketch.`);
      return { k: 'obj', cls: ts.base };
    }
    return err(ts, `Unknown type '${ts.base}'.`);
  }

  /** Emit a conversion of the value on the stack from one type to another (C implicit conversion rules). */
  convert(from: CType, to: CType, pos: { line: number; col: number }, what = 'value') {
    if (to.k === 'void') return;
    if (from.k === 'num' && to.k === 'num') { if (from.n !== to.n) this.emit(Op.CONV, KI[from.n], KI[to.n]); return; }
    if (to.k === 'String') {
      if (from.k === 'String' || from.k === 'cstr') return;
      if (from.k === 'num') { this.emit(Op.CONV, KI[from.n], KI.str); return; }
    }
    if (to.k === 'cstr') {
      if (from.k === 'cstr') return;
      if (from.k === 'String') err(pos, `A String can't be used where const char* text is expected: use .c_str().`);
    }
    if (to.k === 'num' && (from.k === 'String' || from.k === 'cstr')) err(pos, `Text can't be converted to a number automatically. For a String use .toInt() or .toFloat().`);
    if (to.k === 'obj' && from.k === 'obj' && from.cls === to.cls) return;
    if (to.k === 'arr' && from.k === 'arr') return;
    err(pos, `Can't use a ${typeName(from)} as the ${what} (${typeName(to)} expected).`);
  }

  /* ---------------- constant evaluation (array sizes, case labels) ---------------- */

  constEval(e: Expr): number | null {
    switch (e.k) {
      case 'num': return e.value;
      case 'char': return e.value;
      case 'bool': return e.value ? 1 : 0;
      case 'id': {
        const v = this.lookup(e.name);
        if (v?.constValue != null) return v.constValue;
        const c = CONSTANTS[e.name];
        return c ? c.value : null;
      }
      case 'unary': { const v = this.constEval(e.arg); if (v == null) return null; return e.op === '-' ? -v : e.op === '~' ? ~v : e.op === '!' ? (v ? 0 : 1) : v; }
      case 'binary': {
        const a = this.constEval(e.l), b = this.constEval(e.r);
        if (a == null || b == null) return null;
        switch (e.op) {
          case '+': return a + b; case '-': return a - b; case '*': return a * b;
          case '/': return b === 0 ? null : Math.trunc(a / b); case '%': return b === 0 ? null : a % b;
          case '<<': return a << b; case '>>': return a >> b; case '&': return a & b; case '|': return a | b; case '^': return a ^ b;
          default: return null;
        }
      }
      case 'sizeof': {
        try { return this.sizeOf(e); } catch { return null; }
      }
      case 'cast': return this.constEval(e.arg);
      default: return null;
    }
  }

  sizeOf(e: Expr & { k: 'sizeof' }): number {
    const size = (t: CType): number => t.k === 'num' ? SIZEOF[t.n] : t.k === 'arr' ? t.len * size(t.of) : t.k === 'cstr' ? 4 : err(e, `sizeof(${typeName(t)}) is not supported.`);
    if (e.type) return size(this.resolveType(e.type));
    return size(this.typeOfExpr(e.arg!));
  }

  /** Static type of an expression without emitting code (for sizeof). */
  typeOfExpr(e: Expr): CType {
    if (e.k === 'id') { const v = this.lookup(e.name); if (v) return v.type; }
    if (e.k === 'index' && e.obj.k === 'id') { const v = this.lookup(e.obj.name); if (v?.type.k === 'arr') return v.type.of; }
    if (e.k === 'str') return { k: 'arr', of: T.char, len: e.value.length + 1 };
    if (e.k === 'num') return e.float ? (e.f32 ? T.f32 : T.f64) : T.i32;
    return err(e, 'sizeof needs a variable, an array or a type.');
  }

  /* ---------------- scopes ---------------- */

  lookup(name: string): VarInfo | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) { const v = this.scopes[i].get(name); if (v) return v; }
    return this.globals.get(name);
  }

  declareLocal(name: string, type: CType, isConst: boolean, pos: { line: number; col: number }): VarInfo {
    const scope = this.scopes[this.scopes.length - 1];
    if (scope.has(name)) err(pos, `'${name}' is already declared in this block.`);
    const v: VarInfo = { slot: this.nLocals++, type, isConst, global: false, name };
    scope.set(name, v);
    return v;
  }

  tempLocal(): number { return this.nLocals++; }

  declareGlobal(name: string, type: CType, isConst: boolean, pos: { line: number; col: number }): VarInfo {
    if (this.globals.has(name)) err(pos, `'${name}' is already declared.`);
    if (this.userFuncs.has(name)) err(pos, `'${name}' is already the name of a function.`);
    const v: VarInfo = { slot: this.nGlobals++, type, isConst, global: true, name };
    this.globals.set(name, v);
    return v;
  }

  /** Global objects like Serial and Wire get a slot the first time they are used. */
  globalObject(name: string, pos: { line: number; col: number }): VarInfo | undefined {
    const g = GLOBAL_OBJECTS[name];
    if (!g) return undefined;
    let v = this.globals.get(name);
    if (v) return v;
    if (!this.included.has(g.header)) err(pos, `${name} needs #include <${g.header}> at the top of the sketch.`);
    v = { slot: this.nGlobals++, type: { k: 'obj', cls: g.cls }, isConst: true, global: true, name };
    this.globals.set(name, v);
    const slot = v.slot, cls = CLASSES[g.cls];
    this.initThunks.unshift(() => {
      const site = this.site(0, [], true, pos.line);
      this.emit(Op.NATIVE, this.native(`${cls.name}::ctor`, (vm, args) => cls.ctor.run(args, vm)), site);
      this.emit(Op.STOREG, slot);
    });
    return v;
  }

  site(argc: number, kinds: Kind[], pushes: boolean, line: number, extra?: unknown) {
    this.sites.push({ argc, kinds, pushes, line, extra });
    return this.sites.length - 1;
  }

  /* ====================================================================================== */

  run(): Compiled {
    // 1. every function signature first: Arduino generates prototypes, so functions may be used before they are defined
    for (const item of this.items) {
      if (item.k !== 'func') continue;
      const prev = this.userFuncs.get(item.name);
      const ret = this.resolveType(item.ret);
      const params = item.params.map((p) => this.paramType(p.type, p.dims, p));
      if (FUNCTIONS[item.name]) err(item, `'${item.name}' is a built-in Arduino function; pick another name.`);
      if (prev) {
        if (prev.decl.body && item.body) err(item, `Function '${item.name}' is defined twice (overloading is not supported).`);
        if (prev.params.length !== params.length) err(item, `'${item.name}' is declared with ${prev.params.length} parameters but defined with ${params.length} (overloading is not supported).`);
        if (item.body) prev.decl = item;
        continue;
      }
      const index = this.funcs.length;
      this.funcs.push({ name: item.name, entry: -1, nLocals: 0, nParams: params.length, line: item.line, endLine: item.endLine, isVoid: ret.k === 'void' });
      this.userFuncs.set(item.name, { index, decl: item, ret, params });
    }
    for (const req of ['setup', 'loop']) {
      const f = this.userFuncs.get(req);
      if (!f || !f.decl.body) err({ line: 1, col: 1 }, `Every sketch needs a void ${req}() function.`);
      if (f!.params.length) err(f!.decl, `${req}() takes no parameters.`);
    }
    // 2. globals and function bodies, in source order (a global must be declared before a function uses it)
    for (const item of this.items) {
      if (item.k === 'global') this.compileGlobal(item);
      else if (item.body) this.guard(() => this.compileFunction(this.userFuncs.get(item.name)!, item));
    }
    for (const [name, f] of this.userFuncs) if (!f.decl.body) err(f.decl, `Function '${name}' is declared but never defined.`);
    // 3. the init function (globals, objects, static locals), then the bootstrap
    const init = this.funcs.length;
    this.funcs.push({ name: '(global initialisation)', entry: this.here(), nLocals: 0, nParams: 0, line: 1, endLine: 1, isVoid: true });
    this.scopes = [new Map()];
    this.nLocals = 0;
    for (const thunk of this.initThunks) thunk();
    this.emit(Op.RET, 0);
    this.funcs[init].nLocals = this.nLocals;
    const setup = this.userFuncs.get('setup')!, loop = this.userFuncs.get('loop')!;
    this.line = setup.decl.line;
    const boot = this.here();
    this.emit(Op.CALL, init, 0);
    this.emit(Op.CALL, setup.index, 0);
    const top = this.here();
    this.line = loop.decl.line;
    this.emit(Op.CALL, loop.index, 0);
    this.emit(Op.LOOPTICK);
    this.emit(Op.JMP, top);
    const haltPc = this.emit(Op.HALT);
    const funcIndex: Record<string, number> = {};
    for (const [name, f] of this.userFuncs) funcIndex[name] = f.index;
    return {
      code: this.code, lines: this.lines, consts: this.consts, funcs: this.funcs, nGlobals: this.nGlobals,
      globalNames: [...this.globals.values()].map((v) => ({ name: v.name, slot: v.slot, kind: v.type.k === 'obj' ? 'obj' : v.type.k === 'arr' ? 'arr' : kindOf(v.type) })),
      sites: this.sites, natives: this.natives, nativeNames: this.nativeNames, boot, haltPc, funcIndex,
    };
  }

  guard(fn: () => void) {
    try { fn(); } catch (e) { if (e instanceof CompileError) this.diags.push(e.diag); else throw e; }
  }

  paramType(ts: TypeSpec, dims: (Expr | null)[], pos: { line: number; col: number }): CType {
    const base = this.resolveType(ts);
    if (base.k === 'obj') err(pos, 'Library objects can only be used as globals, not passed as parameters.');
    if (dims.length > 1) err(pos, 'Multi-dimensional arrays are not supported.');
    return dims.length ? { k: 'arr', of: base, len: -1 } : base;
  }

  /* ---------------- globals ---------------- */

  compileGlobal(g: GlobalDecl) {
    this.guard(() => {
      const base = this.resolveType(g.type);
      for (const d of g.decls) this.guard(() => {
        const type = this.declType(base, d, g.type);
        const v = this.declareGlobal(d.name, type, g.type.isConst, d);
        if (g.type.isConst && type.k === 'num' && d.init) {
          const cv = this.constEval(d.init);
          if (cv != null) v.constValue = type.k === 'num' && !isFloat(type.n) ? Math.trunc(cv) : cv;
        }
        if (g.type.isConst && !d.init && type.k !== 'obj' && type.k !== 'arr') err(d, `const '${d.name}' needs a value.`);
        this.initThunks.push(() => {
          this.line = d.line;
          this.scopes = [new Map()];
          this.compileInit(type, d, (t) => { this.convert(t, type, d); this.emit(Op.STOREG, v.slot); }, () => this.emit(Op.STOREG, v.slot));
        });
      });
    });
  }

  /** Type of one declarator (arrays get their length from the size or the initializer). */
  declType(base: CType, d: Declarator, ts: TypeSpec): CType {
    if (base.k === 'void') err(d, `A variable can't be void.`);
    if (!d.dims.length) return base;
    if (d.dims.length > 1) err(d, 'Multi-dimensional arrays are not supported: use one array per row.');
    if (base.k === 'obj') err(d, 'Arrays of library objects are not supported.');
    let len: number | null = null;
    if (d.dims[0]) {
      len = this.constEval(d.dims[0]);
      if (len == null) err(d, `The size of array '${d.name}' must be a constant (a number or a const int).`);
    } else if (d.init?.k === 'init') len = d.init.items.length;
    else if (d.init?.k === 'str' && base.k === 'num' && base.n === 'char') len = d.init.value.length + 1;
    else err(d, `Array '${d.name}' needs a size, like ${ts.base} ${d.name}[10].`);
    if (len! <= 0 || len! > 100_000) err(d, `Array size ${len} is not allowed.`);
    return { k: 'arr', of: base, len: len! };
  }

  /** Emit code that leaves the initial value of a declared variable for `store` (or builds an object/array). */
  compileInit(type: CType, d: Declarator, storeTyped: (t: CType) => void, storeRaw: () => void) {
    if (type.k === 'obj') {
      const cls = CLASSES[type.cls];
      const args = d.ctorArgs ?? [];
      if (d.init) {
        // Adafruit_SSD1306 display = Adafruit_SSD1306(128, 64, &Wire, -1);
        if (d.init.k === 'call' && d.init.callee.k === 'id' && d.init.callee.name === type.cls) args.push(...d.init.args);
        else err(d, `Initialise ${type.cls} with ${cls.ctor.doc}`);
      }
      const min = cls.ctor.params.length - (cls.ctor.opt ?? 0);
      if (args.length < min || args.length > cls.ctor.params.length) err(d, `${type.cls} takes ${min === cls.ctor.params.length ? min : `${min}–${cls.ctor.params.length}`} arguments: ${cls.ctor.doc}`);
      const kinds: Kind[] = [];
      args.forEach((a, i) => { const t = this.argument(a, cls.ctor.params[i] ?? 'any', `${type.cls}(…)`); kinds.push(t); });
      const site = this.site(args.length, kinds, true, d.line);
      this.emit(Op.NATIVE, this.native(`${cls.name}::ctor`, (vm, a) => cls.ctor.run(a, vm)), site);
      storeRaw();
      return;
    }
    if (type.k === 'arr') {
      const elem = type.of;
      this.emit(Op.NEWARR, type.len, elem.k === 'num' ? KI[elem.n] : KI.str);
      if (d.init) {
        const items = d.init.k === 'init' ? d.init.items : d.init.k === 'str' && elem.k === 'num' && elem.n === 'char'
          ? [...d.init.value].map((c): Expr => ({ k: 'char', value: c.charCodeAt(0), line: d.line, col: d.col })) : err(d, `Initialise array '${d.name}' with { … }.`);
        if (items.length > type.len) err(d, `Too many values for array '${d.name}' (${items.length} for ${type.len}).`);
        items.forEach((item, i) => {
          this.emit(Op.DUP);
          this.pushConst(i);
          const t = this.expr(item);
          this.convert(t, elem, item, `element ${i}`);
          this.emit(Op.IDXSET);
        });
      }
      storeRaw();
      return;
    }
    if (d.ctorArgs) err(d, `'${d.name}' is not an object: write ${typeName(type)} ${d.name} = …;`);
    if (d.init) {
      if (d.init.k === 'init') {
        if (d.init.items.length !== 1) err(d, `Use = value to initialise '${d.name}'.`);
        storeTyped(this.expr(d.init.items[0]));
      } else storeTyped(this.expr(d.init));
    } else {
      // uninitialised variables start at 0 / empty (on a real ESP32 only globals are guaranteed to be zero)
      this.pushConst(type.k === 'num' ? 0 : '');
      storeTyped(type);
    }
  }

  /* ---------------- functions & statements ---------------- */

  compileFunction(f: UserFunc, decl: FuncDecl) {
    this.funcs[f.index].entry = this.here();
    this.scopes = [new Map()];
    this.nLocals = 0;
    this.fnRet = f.ret;
    this.fnName = decl.name;
    this.loops = [];
    decl.params.forEach((p, i) => this.declareLocal(p.name, f.params[i], p.type.isConst, p));
    this.line = decl.line;
    this.block(decl.body!.body);
    this.line = decl.endLine;
    if (f.ret.k !== 'void') {
      const last = decl.body!.body[decl.body!.body.length - 1];
      if (!last || last.k !== 'return') this.warn({ line: decl.endLine, col: 1 }, `${decl.name}() may end without returning a value.`);
      this.pushConst(f.ret.k === 'num' ? 0 : '');
      this.emit(Op.RET, 1);
    } else this.emit(Op.RET, 0);
    this.funcs[f.index].nLocals = this.nLocals;
  }

  block(body: Stmt[]) {
    this.scopes.push(new Map());
    for (const s of body) this.guard(() => this.stmt(s));
    this.scopes.pop();
  }

  stmt(s: Stmt) {
    this.line = s.line;
    switch (s.k) {
      case 'block': this.block(s.body); return;
      case 'empty': return;
      case 'expr': this.exprStmt(s.expr); return;
      case 'var': {
        const base = this.resolveType(s.type);
        for (const d of s.decls) {
          const type = this.declType(base, d, s.type);
          if (s.type.isStatic) {
            // static locals live as hidden globals, initialised once
            const v = this.declareGlobalHidden(d.name, type, s.type.isConst, d);
            this.scopes[this.scopes.length - 1].set(d.name, v);
            this.initThunks.push(() => {
              this.line = d.line;
              this.compileInit(type, d, (t) => { this.convert(t, type, d); this.emit(Op.STOREG, v.slot); }, () => this.emit(Op.STOREG, v.slot));
            });
            continue;
          }
          if (s.type.isConst && !d.init && type.k !== 'arr') err(d, `const '${d.name}' needs a value.`);
          // compute the initializer before the name is in scope (int x = x; is not allowed)
          let pending: { t?: CType; raw?: boolean } = {};
          this.compileInit(type, d, (t) => { pending = { t }; }, () => { pending = { raw: true }; });
          const v = this.declareLocal(d.name, type, s.type.isConst, d);
          if (pending.t) this.convert(pending.t, type, d);
          this.emit(Op.STOREL, v.slot);
          if (s.type.isConst && type.k === 'num' && d.init) { const cv = this.constEval(d.init); if (cv != null) v.constValue = cv; }
        }
        return;
      }
      case 'if': {
        this.condition(s.test);
        const jz = this.emit(Op.JZ);
        this.stmt(s.then);
        if (s.else) {
          const jmp = this.emit(Op.JMP);
          this.patch(jz, this.here());
          this.stmt(s.else);
          this.patch(jmp, this.here());
        } else this.patch(jz, this.here());
        return;
      }
      case 'while': {
        const top = this.here();
        this.condition(s.test);
        const jz = this.emit(Op.JZ);
        this.loopBody(s.body, top);
        this.emit(Op.JMP, top);
        this.endLoop(jz);
        return;
      }
      case 'do': {
        const top = this.here();
        const loop = { breaks: [] as number[], continues: [] as number[], isSwitch: false };
        this.loops.push(loop);
        this.stmt(s.body);
        this.loops.pop();
        const cond = this.here();
        for (const c of loop.continues) this.patch(c, cond);
        this.line = s.test.line;
        this.condition(s.test);
        this.emit(Op.JNZ, top);
        for (const b of loop.breaks) this.patch(b, this.here());
        return;
      }
      case 'for': {
        this.scopes.push(new Map());
        if (s.init) this.stmt(s.init);
        const top = this.here();
        let jz = -1;
        if (s.test) { this.line = s.line; this.condition(s.test); jz = this.emit(Op.JZ); }
        const loop = { breaks: [] as number[], continues: [] as number[], isSwitch: false };
        this.loops.push(loop);
        this.stmt(s.body);
        this.loops.pop();
        const cont = this.here();
        for (const c of loop.continues) this.patch(c, cont);
        this.line = s.line;
        if (s.update) this.exprStmt(s.update);
        this.emit(Op.JMP, top);
        if (jz >= 0) this.patch(jz, this.here());
        for (const b of loop.breaks) this.patch(b, this.here());
        this.scopes.pop();
        return;
      }
      case 'forrange': {
        if (s.iter.k !== 'id') err(s.iter, 'Range-for works over an array variable: for (int x : values).');
        const arrVar = this.lookup((s.iter as { name: string }).name);
        if (!arrVar || arrVar.type.k !== 'arr') err(s.iter, 'Range-for works over an array variable.');
        const elemT = (arrVar!.type as { of: CType }).of;
        this.scopes.push(new Map());
        const arrSlot = this.tempLocal(), idx = this.tempLocal();
        this.loadVar(arrVar!);
        this.emit(Op.STOREL, arrSlot);
        this.pushConst(0);
        this.emit(Op.STOREL, idx);
        const varT = this.resolveType(s.type);
        const v = this.declareLocal(s.name, varT, s.type.isConst, s);
        const top = this.here();
        this.emit(Op.LOADL, idx); this.emit(Op.LOADL, arrSlot); this.emit(Op.ARRLEN); this.emit(Op.CMP, 2, KI.i32);
        const jz = this.emit(Op.JZ);
        this.emit(Op.LOADL, arrSlot); this.emit(Op.LOADL, idx); this.emit(Op.IDXGET);
        this.convert(elemT, varT, s);
        this.emit(Op.STOREL, v.slot);
        const loop = { breaks: [] as number[], continues: [] as number[], isSwitch: false };
        this.loops.push(loop);
        this.stmt(s.body);
        this.loops.pop();
        const cont = this.here();
        for (const c of loop.continues) this.patch(c, cont);
        this.emit(Op.LOADL, idx); this.pushConst(1); this.emit(Op.BIN, 0, KI.i32); this.emit(Op.STOREL, idx);
        this.emit(Op.JMP, top);
        this.patch(jz, this.here());
        for (const b of loop.breaks) this.patch(b, this.here());
        this.scopes.pop();
        return;
      }
      case 'switch': {
        const t = this.expr(s.disc);
        if (t.k !== 'num' || isFloat(t.n)) err(s.disc, 'switch needs an integer (int, char, byte, …).');
        this.convert(t, T.i32, s.disc);
        const tmp = this.tempLocal();
        this.emit(Op.STOREL, tmp);
        const seen = new Set<number>();
        const jumps: number[] = [];
        let defaultIdx = -1;
        s.cases.forEach((c, i) => {
          if (!c.test) { defaultIdx = i; return; }
          const v = this.constEval(c.test);
          if (v == null) err(c.test, 'A case label must be a constant (a number, a char or a const).');
          if (seen.has(v!)) err(c.test, `case ${v} appears twice.`);
          seen.add(v!);
          this.line = c.line;
          this.emit(Op.LOADL, tmp); this.pushConst(v! | 0); this.emit(Op.CMP, 0, KI.i32);
          jumps[i] = this.emit(Op.JNZ);
        });
        const toDefault = this.emit(Op.JMP);
        const loop = { breaks: [] as number[], continues: [] as number[], isSwitch: true };
        this.loops.push(loop);
        this.scopes.push(new Map());
        s.cases.forEach((c, i) => {
          const at = this.here();
          if (c.test) this.patch(jumps[i], at); else this.patch(toDefault, at);
          for (const b of c.body) this.guard(() => this.stmt(b));
        });
        this.scopes.pop();
        this.loops.pop();
        if (defaultIdx < 0) this.patch(toDefault, this.here());
        for (const b of loop.breaks) this.patch(b, this.here());
        // continue inside a switch belongs to the enclosing loop
        const outer = this.loops[this.loops.length - 1];
        if (loop.continues.length) { if (!outer) err(s, 'continue outside a loop.'); outer.continues.push(...loop.continues); }
        return;
      }
      case 'break': {
        const l = this.loops[this.loops.length - 1];
        if (!l) err(s, 'break outside a loop or switch.');
        l.breaks.push(this.emit(Op.JMP));
        return;
      }
      case 'continue': {
        const l = this.loops[this.loops.length - 1];
        if (!l) err(s, 'continue outside a loop.');
        l.continues.push(this.emit(Op.JMP));
        return;
      }
      case 'return': {
        if (this.fnRet.k === 'void') {
          if (s.value) err(s, `${this.fnName}() is void and can't return a value.`);
          this.emit(Op.RET, 0);
        } else {
          if (!s.value) err(s, `${this.fnName}() must return a ${typeName(this.fnRet)}.`);
          const t = this.expr(s.value!);
          this.convert(t, this.fnRet, s.value!, 'return value');
          this.emit(Op.RET, 1);
        }
        return;
      }
    }
  }

  declareGlobalHidden(name: string, type: CType, isConst: boolean, pos: { line: number; col: number }): VarInfo {
    void pos;
    return { slot: this.nGlobals++, type, isConst, global: true, name };
  }

  loopBody(body: Stmt, continueTarget: number) {
    const loop = { breaks: [] as number[], continues: [] as number[], isSwitch: false };
    this.loops.push(loop);
    this.stmt(body);
    this.loops.pop();
    for (const c of loop.continues) this.patch(c, continueTarget);
    this.pendingBreaks = loop.breaks;
  }
  pendingBreaks: number[] = [];
  endLoop(jz: number) {
    this.patch(jz, this.here());
    for (const b of this.pendingBreaks) this.patch(b, this.here());
    this.pendingBreaks = [];
  }

  /** A condition: anything numeric (or an object, which is always true, like `if (Serial)`). */
  condition(e: Expr) {
    if (e.k === 'assign' && e.op === '=') this.warn(e, 'Assignment (=) inside a condition: did you mean == ?');
    const t = this.expr(e);
    if (t.k === 'String' || t.k === 'cstr') err(e, 'Text is not a true/false condition: compare it, e.g. s == "on" or s.length() > 0.');
    if (t.k === 'void') err(e, 'This call returns nothing, so it can\'t be a condition.');
  }

  exprStmt(e: Expr) {
    if (e.k === 'assign') { this.assign(e, false); return; }
    if (e.k === 'update') { this.update(e, false); return; }
    if (e.k === 'binary' && (e.op === '==' || e.op === '!=' || e.op === '<' || e.op === '>')) this.warn(e, 'This comparison does nothing on its own: did you mean = ?');
    const t = this.expr(e);
    if (t.k !== 'void') this.emit(Op.POP);
  }

  /* ---------------- expressions ---------------- */

  loadVar(v: VarInfo) { this.emit(v.global ? Op.LOADG : Op.LOADL, v.slot); }
  storeVar(v: VarInfo) { this.emit(v.global ? Op.STOREG : Op.STOREL, v.slot); }

  expr(e: Expr): CType {
    const prevLine = this.line;
    if (e.line > this.line) this.line = e.line;
    try { return this.exprInner(e); } finally { this.line = prevLine; }
  }

  private exprInner(e: Expr): CType {
    switch (e.k) {
      case 'num': {
        if (e.float) { this.pushConst(e.f32 ? Math.fround(e.value) : e.value); return e.f32 ? T.f32 : T.f64; }
        let t: CType = e.unsigned ? T.u32 : T.i32;
        if (!e.unsigned && e.value > 2147483647) t = e.value <= 4294967295 ? T.u32 : T.i64;
        this.pushConst(e.value);
        return t;
      }
      case 'str': this.pushConst(e.value); return T.cstr;
      case 'char': this.pushConst(e.value); return T.char;
      case 'bool': this.pushConst(e.value ? 1 : 0); return T.bool;
      case 'id': {
        const v = this.lookup(e.name) ?? this.globalObject(e.name, e);
        if (v) { this.loadVar(v); return v.type; }
        const c = CONSTANTS[e.name];
        if (c) { this.pushConst(c.value); return c.type; }
        if (this.userFuncs.has(e.name)) err(e, `'${e.name}' is a function: call it with ${e.name}().`);
        return err(e, this.undeclared(e.name));
      }
      case 'unary': {
        const t = this.expr(e.arg);
        if (e.op === '!') { if (t.k === 'String' || t.k === 'cstr') err(e, 'The ! operator needs a number or a bool.'); this.emit(Op.NOT); return T.bool; }
        if (t.k !== 'num') return err(e, `The ${e.op} operator needs a number, not a ${typeName(t)}.`);
        const rt = arith(t.n, t.n);
        this.convert(t, { k: 'num', n: rt }, e);
        if (e.op === '-') this.emit(Op.NEG, KI[rt]);
        if (e.op === '~') { if (isFloat(rt)) err(e, '~ needs an integer.'); this.emit(Op.BNOT, KI[rt]); }
        return { k: 'num', n: rt };
      }
      case 'update': return this.update(e, true);
      case 'assign': return this.assign(e, true);
      case 'binary': return this.binary(e);
      case 'logical': {
        this.condition(e.l);
        if (e.op === '&&') {
          const jz = this.emit(Op.JZ);
          this.condition(e.r);
          this.emit(Op.NOT); this.emit(Op.NOT);
          const jmp = this.emit(Op.JMP);
          this.patch(jz, this.here());
          this.pushConst(0);
          this.patch(jmp, this.here());
        } else {
          const jnz = this.emit(Op.JNZ);
          this.condition(e.r);
          this.emit(Op.NOT); this.emit(Op.NOT);
          const jmp = this.emit(Op.JMP);
          this.patch(jnz, this.here());
          this.pushConst(1);
          this.patch(jmp, this.here());
        }
        return T.bool;
      }
      case 'cond': {
        this.condition(e.test);
        const jz = this.emit(Op.JZ);
        // both branches must agree on a type: compile the first, peek the second's type, convert both to the common one
        const ta = this.peekType(e.a), tb = this.peekType(e.b);
        const common = this.commonType(ta, tb, e);
        this.convert(this.expr(e.a), common, e.a);
        const jmp = this.emit(Op.JMP);
        this.patch(jz, this.here());
        this.convert(this.expr(e.b), common, e.b);
        this.patch(jmp, this.here());
        return common;
      }
      case 'call': return this.call(e, true);
      case 'member': return err(e, `'${e.prop}' must be called like a function: ${e.prop}(…).`);
      case 'index': {
        const ot = this.peekType(e.obj);
        if (ot.k === 'String') {
          this.expr(e.obj);
          this.numArg(e.index, 'index');
          this.emit(Op.STRIDX);
          return T.char;
        }
        const lv = this.lvalue(e);
        this.loadLv(lv);
        return lv.type;
      }
      case 'cast': {
        const to = this.resolveType(e.type);
        const t = this.expr(e.arg);
        if (to.k === 'num' && t.k !== 'num') err(e, `Can't convert ${typeName(t)} to ${typeName(to)}${t.k === 'String' ? ': use .toInt() or .toFloat()' : ''}.`);
        this.convert(t, to, e);
        return to;
      }
      case 'sizeof': { const v = this.sizeOf(e); this.pushConst(v); return T.u32; }
      case 'addr': return err(e, 'The & (address-of) operator is only supported as &Wire in a display constructor.');
      case 'scoped': return err(e, `${e.ns}::${e.name} must be called like a function.`);
      case 'init': return err(e, 'A { … } list can only initialise an array.');
    }
  }

  /** Type of an expression, without leaving code behind. */
  peekType(e: Expr): CType {
    const mark = this.code.length, lmark = this.lines.length, sites = this.sites.length, locals = this.nLocals;
    const diagCount = this.diags.length;
    try { return this.expr(e); } finally {
      this.code.length = mark; this.lines.length = lmark; this.sites.length = sites; this.nLocals = locals;
      this.diags.length = diagCount;
    }
  }

  commonType(a: CType, b: CType, pos: Expr): CType {
    if (a.k === 'num' && b.k === 'num') return a.n === 'bool' && b.n === 'bool' ? T.bool : { k: 'num', n: arith(a.n, b.n) };
    if ((a.k === 'String' || a.k === 'cstr') && (b.k === 'String' || b.k === 'cstr')) return a.k === 'String' || b.k === 'String' ? T.String : T.cstr;
    if (a.k === 'String' && b.k === 'num') return T.String;
    if (b.k === 'String' && a.k === 'num') return T.String;
    return err(pos, `The two branches of ?: have different types (${typeName(a)} and ${typeName(b)}).`);
  }

  numArg(e: Expr, what: string): NumKind {
    const t = this.expr(e);
    if (t.k !== 'num') err(e, `The ${what} must be a number.`);
    this.convert(t, T.i32, e);
    return 'i32';
  }

  binary(e: Expr & { k: 'binary' }): CType {
    const lt = this.peekType(e.l), rt = this.peekType(e.r);
    const isCmp = (CMP_OPS as readonly string[]).includes(e.op);
    // text
    if (lt.k === 'String' || rt.k === 'String' || lt.k === 'cstr' || rt.k === 'cstr') {
      if (e.op === '+') {
        if (lt.k !== 'String' && rt.k !== 'String') {
          return err(e, lt.k === 'cstr' && rt.k === 'cstr'
            ? 'Two "text" literals can\'t be added with + in C++. Write String("a") + "b", or just "ab".'
            : 'In C++, "text" + number does pointer arithmetic, not joining. Wrap the text in String(…): String("T = ") + t.');
        }
        this.convert(this.expr(e.l), T.String, e.l);
        this.convert(this.expr(e.r), T.String, e.r);
        this.emit(Op.BIN, 0, KI.str);
        return T.String;
      }
      if (isCmp && (e.op === '==' || e.op === '!=' || lt.k === 'String' || rt.k === 'String')) {
        if (lt.k === 'cstr' && rt.k === 'cstr') err(e, 'Comparing two "text" pointers compares addresses, not text. Use String: String(a) == b.');
        if (lt.k === 'num' || rt.k === 'num') err(e, `Can't compare text with a number.`);
        this.expr(e.l); this.expr(e.r);
        this.emit(Op.CMP, CMP_OPS.indexOf(e.op as never), KI.str);
        return T.bool;
      }
      return err(e, `The ${e.op} operator doesn't work on text.`);
    }
    if (lt.k !== 'num' || rt.k !== 'num') return err(e, `The ${e.op} operator needs numbers (got ${typeName(lt)} and ${typeName(rt)}).`);
    const k = arith(lt.n, rt.n);
    if (['%', '<<', '>>', '&', '|', '^'].includes(e.op) && isFloat(k)) err(e, e.op === '%' ? '% needs integers: for floats use fmod(a, b).' : `${e.op} needs integers.`);
    if (e.op === '/' || e.op === '%') { const d = this.constEval(e.r); if (d === 0) err(e.r, 'Division by zero.'); }
    if (isCmp && lt.n !== rt.n && !isFloat(k) && (lt.n === 'u32' || rt.n === 'u32') && ['i32', 'i16', 'i8', 'char'].includes(lt.n === 'u32' ? rt.n : lt.n)) {
      const other = lt.n === 'u32' ? e.r : e.l;
      const cv = this.constEval(other);
      if (cv == null || cv < 0) this.warn(e, 'Comparing a signed and an unsigned number: a negative value becomes a huge unsigned one (as in C).');
    }
    // shifts keep the left operand's (promoted) type
    const opKind: NumKind = e.op === '<<' || e.op === '>>' ? arith(lt.n, lt.n) : k;
    this.convert(this.expr(e.l), { k: 'num', n: opKind }, e.l);
    this.convert(this.expr(e.r), { k: 'num', n: e.op === '<<' || e.op === '>>' ? 'i32' : opKind }, e.r);
    if (isCmp) { this.emit(Op.CMP, CMP_OPS.indexOf(e.op as never), KI[opKind]); return T.bool; }
    this.emit(Op.BIN, BIN_OPS.indexOf(e.op as never), KI[opKind]);
    return { k: 'num', n: opKind };
  }

  /* ---------------- lvalues: variables and array elements ---------------- */

  lvalue(e: Expr): { v: VarInfo; index?: Expr; type: CType } {
    if (e.k === 'id') {
      const v = this.lookup(e.name);
      if (!v) {
        if (CONSTANTS[e.name]) err(e, `${e.name} is a built-in constant and can't be changed.`);
        if (GLOBAL_OBJECTS[e.name]) err(e, `${e.name} can't be assigned.`);
        err(e, this.undeclared(e.name));
      }
      return { v: v!, type: v!.type };
    }
    if (e.k === 'index') {
      if (e.obj.k !== 'id') err(e, 'Only array variables can be indexed, like values[i].');
      const v = this.lookup((e.obj as { name: string }).name);
      if (!v) err(e.obj, this.undeclared((e.obj as { name: string }).name));
      if (v!.type.k !== 'arr') err(e, `'${v!.name}' is not an array.`);
      return { v: v!, index: e.index, type: (v!.type as { of: CType }).of };
    }
    return err(e, 'You can only assign to a variable or an array element.');
  }

  /** Pushes the address part of an element lvalue (array, index); nothing for plain variables. */
  pushLvAddr(lv: { v: VarInfo; index?: Expr }) {
    if (!lv.index) return;
    this.loadVar(lv.v);
    this.numArg(lv.index, 'array index');
  }

  loadLv(lv: { v: VarInfo; index?: Expr; type: CType }) {
    if (lv.index) { this.pushLvAddr(lv); this.emit(Op.IDXGET); } else this.loadVar(lv.v);
  }

  assign(e: Expr & { k: 'assign' }, wantValue: boolean): CType {
    const lv = this.lvalue(e.target);
    if (lv.v.isConst) err(e, `'${lv.v.name}' is const and can't be changed.`);
    if (lv.type.k === 'arr') err(e, 'Whole arrays can\'t be assigned: copy them element by element.');
    if (lv.type.k === 'obj') err(e, 'Library objects can\'t be assigned.');
    this.pushLvAddr(lv);
    if (e.op === '=') {
      const t = this.expr(e.value);
      this.convert(t, lv.type, e.value);
    } else {
      const op = e.op.slice(0, -1);
      if (lv.index) this.emit(Op.DUP2);
      if (lv.index) this.emit(Op.IDXGET); else this.loadVar(lv.v);
      if (lv.type.k === 'String') {
        if (op !== '+') err(e, `${e.op} doesn't work on a String.`);
        this.convert(this.expr(e.value), T.String, e.value);
        this.emit(Op.BIN, 0, KI.str);
      } else {
        if (lv.type.k !== 'num') err(e, `${e.op} needs a number.`);
        const vt = this.peekType(e.value);
        if (vt.k !== 'num') err(e.value, `${e.op} needs a number on the right.`);
        const k = op === '<<' || op === '>>' ? arith((lv.type as { n: NumKind }).n, (lv.type as { n: NumKind }).n) : arith((lv.type as { n: NumKind }).n, (vt as { n: NumKind }).n);
        if (['%', '<<', '>>', '&', '|', '^'].includes(op) && isFloat(k)) err(e, `${e.op} needs integers.`);
        if (op === '/' || op === '%') { const d = this.constEval(e.value); if (d === 0) err(e.value, 'Division by zero.'); }
        this.convert(lv.type, { k: 'num', n: k }, e);
        this.convert(this.expr(e.value), { k: 'num', n: op === '<<' || op === '>>' ? 'i32' : k }, e.value);
        this.emit(Op.BIN, BIN_OPS.indexOf(op as never), KI[k]);
        this.convert({ k: 'num', n: k }, lv.type, e);
      }
    }
    return this.storeLv(lv, wantValue);
  }

  storeLv(lv: { v: VarInfo; index?: Expr; type: CType }, wantValue: boolean): CType {
    if (lv.index) {
      if (wantValue) { const tmp = this.tempLocal(); this.emit(Op.DUP); this.emit(Op.STOREL, tmp); this.emit(Op.IDXSET); this.emit(Op.LOADL, tmp); }
      else this.emit(Op.IDXSET);
    } else {
      if (wantValue) this.emit(Op.DUP);
      this.storeVar(lv.v);
    }
    return wantValue ? lv.type : T.void;
  }

  update(e: Expr & { k: 'update' }, wantValue: boolean): CType {
    const lv = this.lvalue(e.arg);
    if (lv.v.isConst) err(e, `'${lv.v.name}' is const and can't be changed.`);
    if (lv.type.k !== 'num') err(e, `${e.op} needs a number variable.`);
    const n = (lv.type as { n: NumKind }).n;
    const k = arith(n, 'i32');
    this.pushLvAddr(lv);
    if (lv.index) this.emit(Op.DUP2);
    if (lv.index) this.emit(Op.IDXGET); else this.loadVar(lv.v);
    let old = -1;
    if (wantValue && !e.prefix) { old = this.tempLocal(); this.emit(Op.DUP); this.emit(Op.STOREL, old); }
    this.convert(lv.type, { k: 'num', n: k }, e);
    this.pushConst(1);
    this.emit(Op.BIN, e.op === '++' ? 0 : 1, KI[k]);
    this.convert({ k: 'num', n: k }, lv.type, e);
    if (wantValue && e.prefix) return this.storeLv(lv, true);
    this.storeLv(lv, false);
    if (wantValue) { this.emit(Op.LOADL, old); return lv.type; }
    return T.void;
  }

  /* ---------------- calls ---------------- */

  call(e: Expr & { k: 'call' }, wantValue: boolean): CType {
    void wantValue;
    const c = e.callee;
    if (c.k === 'id') {
      const name = c.name;
      if (this.lookup(name)) err(c, `'${name}' is a variable, not a function.`);
      const uf = this.userFuncs.get(name);
      if (uf) {
        if (e.args.length !== uf.params.length) err(e, `${name}() takes ${uf.params.length} argument${uf.params.length === 1 ? '' : 's'}, not ${e.args.length}.`);
        e.args.forEach((a, i) => {
          const pt = uf.params[i];
          const t = this.expr(a);
          if (pt.k === 'arr') { if (t.k !== 'arr') err(a, `Argument ${i + 1} of ${name}() must be an array.`); }
          else this.convert(t, pt, a, `argument ${i + 1} of ${name}()`);
        });
        this.emit(Op.CALL, uf.index, e.args.length);
        return uf.ret;
      }
      if (name === 'String') return this.stringCtor(e);
      if (CLASSES[name]) err(e, `Declare ${name} objects as variables: ${CLASSES[name].ctor.doc}`);
      const spec = FUNCTIONS[name];
      if (spec) return this.nativeCall(name, spec, null, e.args, e);
      const why = unsupportedFunction(name);
      if (why) err(c, `${name}() is not supported in ESP32 Lab. ${why}`);
      return err(c, this.undeclared(name, true));
    }
    if (c.k === 'scoped') {
      const key = `${c.ns}::${c.name}`;
      const spec = STATICS[key];
      if (!spec) err(c, `${key}() is not supported.`);
      return this.nativeCall(key, spec, null, e.args, e);
    }
    if (c.k === 'member') {
      const ot = this.peekType(c.obj);
      if (ot.k === 'String' || ot.k === 'cstr') {
        const spec = STRING_METHODS[c.prop];
        if (!spec) err(c, `String has no method ${c.prop}() here. Supported: ${Object.keys(STRING_METHODS).join(', ')}.`);
        if (spec.mutates) {
          if (ot.k !== 'String') err(c, `${c.prop}() changes a String in place; it can't be used on "text".`);
          const lv = this.lvalue(c.obj);
          this.pushLvAddr(lv);
          this.nativeCall(`String.${c.prop}`, { ...spec, ret: T.String }, () => { this.loadLv(lv); return T.String; }, e.args, e);
          this.storeLv(lv, false);
          return T.void;
        }
        return this.nativeCall(`String.${c.prop}`, spec, () => this.expr(c.obj), e.args, e);
      }
      if (ot.k !== 'obj') return err(c, `${typeName(ot)} has no method ${c.prop}().`);
      const cls = CLASSES[ot.cls];
      const spec = cls.methods[c.prop];
      if (!spec) return err(c, `${ot.cls}.${c.prop}() is not supported in ESP32 Lab. Supported: ${Object.keys(cls.methods).join(', ')}.`);
      return this.nativeCall(`${ot.cls}.${c.prop}`, spec, () => this.expr(c.obj), e.args, e);
    }
    return err(e, 'Only functions and object methods can be called.');
  }

  stringCtor(e: Expr & { k: 'call' }): CType {
    if (e.args.length === 0) { this.pushConst(''); return T.String; }
    if (e.args.length > 2) err(e, 'String(value[, decimals or base]) takes at most 2 arguments.');
    const t = this.expr(e.args[0]);
    if (t.k === 'String' || t.k === 'cstr') { if (e.args.length > 1) err(e, 'String(text) takes one argument.'); return T.String; }
    if (t.k !== 'num') return err(e, `Can't make a String from ${typeName(t)}.`);
    if (e.args.length === 1) { this.emit(Op.CONV, KI[t.n], KI.str); return T.String; }
    this.numArg(e.args[1], 'second argument');
    const kind = t.n as Kind;
    const site = this.site(2, [kind, 'i32'], true, e.line);
    this.emit(Op.NATIVE, this.native(`String(${kind},fmt)`, (_vm, a) => {
      const v = a[0] as number, f = a[1] as number;
      if (kind === 'f32' || kind === 'f64') return toText(v, kind, f);
      return [2, 8, 16].includes(f) ? (v < 0 ? v >>> 0 : v).toString(f) : String(v);
    }), site);
    return T.String;
  }

  /** One checked argument for a native; returns its kind for the call site. */
  argument(a: Expr, p: string, fname: string): Kind {
    if (p === 'func') {
      if (a.k !== 'id' || !this.userFuncs.has(a.name)) err(a, `${fname} needs the name of one of your functions here.`);
      const f = this.userFuncs.get((a as { name: string }).name)!;
      if (f.params.length || f.ret.k !== 'void') err(a, `An interrupt handler must be a void function with no parameters.`);
      this.pushConst(f.index);
      return 'i32';
    }
    if (p === 'obj') {
      const inner = a.k === 'addr' ? a.arg : a;
      if (inner.k !== 'id') err(a, `${fname} expects an object like &Wire here.`);
      const v = this.lookup((inner as { name: string }).name) ?? this.globalObject((inner as { name: string }).name, inner);
      if (!v || v.type.k !== 'obj') err(a, `${fname} expects an object like &Wire here.`);
      this.loadVar(v!);
      return 'i32';
    }
    if (a.k === 'addr') err(a, 'The & (address-of) operator is only supported as &Wire.');
    const t = this.expr(a);
    if (p === 'arr' || (p === 'arrnum' && t.k === 'arr')) {
      if (t.k !== 'arr' || t.of.k !== 'num') err(a, `${fname} expects a number array here.`);
      return 'i32';
    }
    if (t.k === 'arr') {
      if (t.of.k === 'num' && t.of.n === 'char' && (p === 'any' || p === 'text')) {
        // a char[] used as text: read up to the terminating 0
        const site = this.site(1, ['i32'], true, a.line);
        this.emit(Op.NATIVE, this.native('char[]→text', (_vm, x) => { let s = ''; for (const c of x[0] as number[]) { if (!c) break; s += String.fromCharCode(c & 0xff); } return s; }), site);
        return 'str';
      }
      err(a, `${fname} can't take a whole array here.`);
    }
    if (t.k === 'obj') err(a, `${fname} can't take ${t.cls} object here.`);
    if (t.k === 'void') err(a, `This call returns nothing, so it can't be passed to ${fname}.`);
    switch (p) {
      case 'int': if (t.k !== 'num') err(a, `${fname} expects a number here, not ${typeName(t)}.`); if (isFloat((t as { n: NumKind }).n)) this.convert(t, T.i32, a); return isNum(t) && isFloat(t.n) ? 'i32' : kindOf(t);
      case 'num': if (t.k !== 'num') err(a, `${fname} expects a number here, not ${typeName(t)}.`); return kindOf(t);
      case 'bool': if (t.k !== 'num') err(a, `${fname} expects true or false here.`); return kindOf(t);
      case 'text': if (t.k !== 'String' && t.k !== 'cstr') err(a, `${fname} expects text here, not ${typeName(t)}.`); return 'str';
      default: return kindOf(t);
    }
  }

  nativeCall(name: string, spec: NativeSpec, receiver: (() => CType) | null, args: Expr[], e: Expr): CType {
    const min = spec.params.length - (spec.opt ?? 0), max = spec.varargs ? Infinity : spec.params.length;
    if (args.length < min || args.length > max) {
      err(e, `${name}() takes ${min === max ? min : max === Infinity ? `at least ${min}` : `${min} to ${max}`} argument${max === 1 ? '' : 's'}, not ${args.length}: ${spec.doc}`);
    }
    const kinds: Kind[] = [];
    const types: CType[] = [];
    if (receiver) { receiver(); kinds.push('i32'); }
    args.forEach((a, i) => {
      const p = spec.params[i] ?? 'any';
      types.push(p === 'func' || p === 'obj' ? T.i32 : this.peekType(a));
      kinds.push(this.argument(a, p, `${name}()`));
    });
    const ret = typeof spec.ret === 'function' ? spec.ret(types) : spec.ret;
    const site = this.site(kinds.length, kinds, ret.k !== 'void', e.line);
    this.emit(Op.NATIVE, this.native(name, spec.run), site);
    return ret;
  }

  undeclared(name: string, call = false): string {
    const all = [...this.globals.keys(), ...this.scopes.flatMap((s) => [...s.keys()]), ...this.userFuncs.keys(), ...Object.keys(FUNCTIONS), ...Object.keys(CONSTANTS), ...Object.keys(GLOBAL_OBJECTS)];
    const near = all.map((n) => [n, distance(n.toLowerCase(), name.toLowerCase())] as const).filter(([, d]) => d <= Math.max(1, Math.floor(name.length / 4))).sort((a, b) => a[1] - b[1])[0];
    return `'${name}' was not declared${call ? ' (not a supported function)' : ''}.${near ? ` Did you mean '${near[0]}'?` : ''}`;
  }
}

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
