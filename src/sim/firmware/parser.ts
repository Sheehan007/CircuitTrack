// Recursive-descent parser for the Arduino-C++ subset. Syntax errors are collected with line numbers; after an error
// the parser skips to the next ';' or '}' and carries on, so one typo doesn't hide the rest.
import type { Declarator, Expr, FuncDecl, GlobalDecl, Param, Program, Stmt, TypeSpec } from './ast';
import { CompileError, type Diagnostic } from './diagnostics';
import type { Token } from './lexer';

const TYPE_WORDS = new Set([
  'void', 'bool', 'boolean', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned', 'byte', 'word', 'String', 'size_t',
  'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t', 'uint64_t', 'int64_t',
]);
const QUALIFIERS = new Set(['const', 'volatile', 'static', 'constexpr', 'inline', 'register']);
const UNSUPPORTED_KEYWORDS: Record<string, string> = {
  struct: 'Structs are not supported yet: use separate variables or arrays.',
  class: 'Defining classes is not supported: use functions and global variables.',
  enum: 'enum is not supported yet: use const int values.',
  union: 'union is not supported.',
  typedef: 'typedef is not supported.',
  template: 'Templates are not supported.',
  namespace: 'Namespaces are not supported.',
  using: '`using` is not supported.',
  goto: 'goto is not supported.',
  new: 'Dynamic allocation (new) is not supported.',
  delete: 'Dynamic allocation (delete) is not supported.',
  auto: '`auto` is not supported: write the type (int, float, …).',
  extern: '`extern` is not supported in a single-file sketch.',
  try: 'Exceptions are not supported.',
  throw: 'Exceptions are not supported.',
};

const BIN_PREC: Record<string, number> = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '<=': 7, '>': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10,
};
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);

export function parse(tokens: Token[], classes: Set<string>, diags: Diagnostic[]): Program {
  let i = 0;
  const peek = (o = 0) => tokens[Math.min(i + o, tokens.length - 1)];
  const at = (text: string, o = 0) => { const t = peek(o); return (t.kind === 'punct' || t.kind === 'id') && t.text === text; };
  const fail = (msg: string, t = peek()): never => { throw new CompileError({ line: t.line, col: t.col, severity: 'error', message: msg }); };
  const expect = (text: string, what?: string) => {
    if (!at(text)) {
      // a missing ';' belongs to the end of the previous token (like gcc), not to the next line's first word
      const prev = i > 0 ? tokens[i - 1] : undefined;
      const where = text === ';' && prev && prev.line < peek().line ? { ...prev, col: prev.col + prev.text.length } : peek();
      fail(`Expected '${text}'${what ? ` ${what}` : ''} but found ${describe(peek())}.`, where);
    }
    return tokens[i++];
  };
  const describe = (t: Token) => (t.kind === 'eof' ? 'the end of the sketch' : t.kind === 'str' ? 'a string' : `'${t.text}'`);
  const isTypeStart = (o = 0) => {
    const t = peek(o);
    return t.kind === 'id' && (TYPE_WORDS.has(t.text) || QUALIFIERS.has(t.text) || classes.has(t.text));
  };

  function parseType(): TypeSpec {
    const start = peek();
    let isConst = false, isStatic = false;
    const words: string[] = [];
    for (;;) {
      const t = peek();
      if (t.kind !== 'id') break;
      if (t.text === 'const' || t.text === 'constexpr') { isConst = true; i++; continue; }
      if (t.text === 'static') { isStatic = true; i++; continue; }
      if (QUALIFIERS.has(t.text)) { i++; continue; }
      if (TYPE_WORDS.has(t.text) || (classes.has(t.text) && !words.length)) {
        if (classes.has(t.text) || t.text === 'String') { words.push(t.text); i++; break; }
        words.push(t.text); i++;
        continue;
      }
      break;
    }
    // trailing const (char const *)
    while (at('const')) { isConst = true; i++; }
    let ptr = 0;
    while (at('*')) { ptr++; i++; while (at('const')) i++; }
    if (at('&')) fail('References (&) are not supported. Pass values, or use a global variable.');
    if (!words.length) fail(`Expected a type (int, float, bool, …) but found ${describe(peek())}.`, start);
    return { base: normaliseType(words, start), isConst, isStatic, ptr, line: start.line, col: start.col };
  }

  function normaliseType(w: string[], t: Token): string {
    if (w.length === 1) return w[0] === 'boolean' ? 'bool' : w[0] === 'signed' ? 'int' : w[0];
    const has = (x: string) => w.includes(x);
    const longs = w.filter((x) => x === 'long').length;
    if (has('unsigned')) {
      if (has('char')) return 'unsigned char';
      if (has('short')) return 'unsigned short';
      if (longs >= 2) return 'unsigned long long';
      if (longs === 1) return 'unsigned long';
      return 'unsigned int';
    }
    if (has('signed') && has('char')) return 'signed char';
    if (longs >= 2) return 'long long';
    if (longs === 1 && has('double')) return 'double';
    if (longs === 1) return 'long';
    if (has('short')) return 'short';
    const rest = w.filter((x) => x !== 'signed' && x !== 'int');
    if (rest.length === 0) return 'int';
    if (rest.length === 1) return rest[0];
    return fail(`'${w.join(' ')}' is not a type this simulator understands.`, t);
  }

  /* ---------------- expressions ---------------- */

  function parseExpr(): Expr { return parseAssign(); }

  function parseAssign(): Expr {
    const left = parseCond();
    const t = peek();
    if (t.kind === 'punct' && ASSIGN_OPS.has(t.text)) {
      i++;
      const value = parseAssign();
      return { k: 'assign', op: t.text, target: left, value, line: t.line, col: t.col };
    }
    return left;
  }

  function parseCond(): Expr {
    const test = parseBinary(1);
    if (at('?')) {
      const t = tokens[i++];
      const a = parseAssign();
      expect(':', 'in a ?: expression');
      const b = parseCond();
      return { k: 'cond', test, a, b, line: t.line, col: t.col };
    }
    return test;
  }

  function parseBinary(minPrec: number): Expr {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      const prec = t.kind === 'punct' ? BIN_PREC[t.text] : undefined;
      if (prec == null || prec < minPrec) return left;
      i++;
      const right = parseBinary(prec + 1);
      left = t.text === '&&' || t.text === '||'
        ? { k: 'logical', op: t.text, l: left, r: right, line: t.line, col: t.col }
        : { k: 'binary', op: t.text, l: left, r: right, line: t.line, col: t.col };
    }
  }

  function parseUnary(): Expr {
    const t = peek();
    if (t.kind === 'punct') {
      if (t.text === '++' || t.text === '--') { i++; return { k: 'update', op: t.text, prefix: true, arg: parseUnary(), line: t.line, col: t.col }; }
      if (t.text === '-' || t.text === '+' || t.text === '!' || t.text === '~') { i++; return { k: 'unary', op: t.text, arg: parseUnary(), line: t.line, col: t.col }; }
      if (t.text === '&') { i++; return { k: 'addr', arg: parseUnary(), line: t.line, col: t.col }; }
      if (t.text === '*') fail('Pointer dereference (*p) is not supported.');
      // C-style cast: (type) expr
      if (t.text === '(' && isTypeStart(1) && !classes.has(peek(1).text)) {
        i++;
        const type = parseType();
        expect(')', 'after the cast type');
        return { k: 'cast', type, arg: parseUnary(), line: t.line, col: t.col };
      }
    }
    if (t.kind === 'id' && t.text === 'sizeof') {
      i++;
      expect('(', 'after sizeof');
      let e: Expr;
      if (isTypeStart()) { const type = parseType(); e = { k: 'sizeof', type, line: t.line, col: t.col }; }
      else e = { k: 'sizeof', arg: parseExpr(), line: t.line, col: t.col };
      expect(')', 'to close sizeof(');
      return e;
    }
    return parsePostfix(parsePrimary());
  }

  function parsePostfix(e: Expr): Expr {
    for (;;) {
      const t = peek();
      if (at('(')) {
        i++;
        const args: Expr[] = [];
        if (!at(')')) { do { args.push(parseAssign()); } while (at(',') && ++i); }
        expect(')', 'to close the call');
        e = { k: 'call', callee: e, args, line: e.line, col: e.col };
      } else if (at('[')) {
        i++;
        const index = parseExpr();
        expect(']', 'to close the index');
        e = { k: 'index', obj: e, index, line: t.line, col: t.col };
      } else if (at('.') || at('->')) {
        i++;
        const p = peek();
        if (p.kind !== 'id') fail('Expected a member name after "."');
        i++;
        e = { k: 'member', obj: e, prop: p.text, arrow: t.text === '->', line: p.line, col: p.col };
      } else if (at('++') || at('--')) {
        i++;
        e = { k: 'update', op: t.text as '++' | '--', prefix: false, arg: e, line: t.line, col: t.col };
      } else return e;
    }
  }

  function parsePrimary(): Expr {
    const t = peek();
    if (t.kind === 'num') { i++; return { k: 'num', value: t.value!, float: t.numKind!.float, f32: t.numKind!.f32, unsigned: t.numKind!.unsigned, long: t.numKind!.long, line: t.line, col: t.col }; }
    if (t.kind === 'str') { i++; return { k: 'str', value: t.text, line: t.line, col: t.col }; }
    if (t.kind === 'char') { i++; return { k: 'char', value: t.value!, line: t.line, col: t.col }; }
    if (t.kind === 'id') {
      if (t.text === 'true' || t.text === 'false') { i++; return { k: 'bool', value: t.text === 'true', line: t.line, col: t.col }; }
      if (UNSUPPORTED_KEYWORDS[t.text]) fail(UNSUPPORTED_KEYWORDS[t.text]);
      // functional cast / conversion: int(x), float(x), String(x), byte(x)
      if (TYPE_WORDS.has(t.text) && at('(', 1) && t.text !== 'String') {
        i++;
        expect('(');
        const arg = parseExpr();
        expect(')', 'to close the conversion');
        return { k: 'cast', type: { base: normaliseType([t.text], t), isConst: false, isStatic: false, ptr: 0, line: t.line, col: t.col }, arg, line: t.line, col: t.col };
      }
      i++;
      if (at('::')) {
        i++;
        const n = peek();
        if (n.kind !== 'id') fail('Expected a name after ::');
        i++;
        return { k: 'scoped', ns: t.text, name: n.text, line: t.line, col: t.col };
      }
      return { k: 'id', name: t.text, line: t.line, col: t.col };
    }
    if (at('(')) {
      i++;
      const e = parseExpr();
      if (at(',')) fail('The comma operator is not supported.');
      expect(')', 'to close the parenthesis');
      return e;
    }
    if (at('{')) {
      i++;
      const items: Expr[] = [];
      while (!at('}')) {
        items.push(at('{') ? parsePrimary() : parseAssign());
        if (!at(',')) break;
        i++;
      }
      expect('}', 'to close the initializer list');
      return { k: 'init', items, line: t.line, col: t.col };
    }
    return fail(`Expected a value but found ${describe(t)}.`);
  }

  /* ---------------- declarations & statements ---------------- */

  function parseDeclarators(type: TypeSpec): Declarator[] {
    const decls: Declarator[] = [];
    do {
      while (at('*')) { type = { ...type, ptr: type.ptr + 1 }; i++; }
      const n = peek();
      if (n.kind !== 'id') fail(`Expected a variable name but found ${describe(n)}.`);
      i++;
      const d: Declarator = { name: n.text, dims: [], line: n.line, col: n.col };
      while (at('[')) {
        i++;
        d.dims.push(at(']') ? null : parseExpr());
        expect(']', 'to close the array size');
      }
      if (at('(') && classes.has(type.base)) {
        i++;
        d.ctorArgs = [];
        if (!at(')')) { do { d.ctorArgs.push(parseAssign()); } while (at(',') && ++i); }
        expect(')', 'to close the constructor arguments');
      } else if (at('=')) {
        i++;
        d.init = at('{') ? parsePrimary() : parseAssign();
      }
      decls.push(d);
    } while (at(',') && ++i);
    return decls;
  }

  function parseStmt(): Stmt {
    const t = peek();
    if (t.kind === 'id' && UNSUPPORTED_KEYWORDS[t.text]) fail(UNSUPPORTED_KEYWORDS[t.text]);
    if (at('{')) return parseBlock();
    if (at(';')) { i++; return { k: 'empty', line: t.line, col: t.col }; }
    if (at('if')) {
      i++; expect('(', 'after if');
      const test = parseExpr(); expect(')', 'to close the if condition');
      const then = parseStmt();
      let els: Stmt | undefined;
      if (at('else')) { i++; els = parseStmt(); }
      return { k: 'if', test, then, else: els, line: t.line, col: t.col };
    }
    if (at('while')) {
      i++; expect('(', 'after while');
      const test = parseExpr(); expect(')', 'to close the while condition');
      return { k: 'while', test, body: parseStmt(), line: t.line, col: t.col };
    }
    if (at('do')) {
      i++;
      const body = parseStmt();
      expect('while', 'after a do { } block'); expect('(');
      const test = parseExpr(); expect(')'); expect(';', 'after do … while (…)');
      return { k: 'do', body, test, line: t.line, col: t.col };
    }
    if (at('for')) {
      i++; expect('(', 'after for');
      let init: Stmt | null = null;
      if (isTypeStart()) {
        const type = parseType();
        const n = peek();
        if (n.kind === 'id' && at(':', 1)) {
          i += 2;
          const iter = parseExpr(); expect(')');
          return { k: 'forrange', type, name: n.text, iter, body: parseStmt(), line: t.line, col: t.col };
        }
        init = { k: 'var', type, decls: parseDeclarators(type), line: t.line, col: t.col };
        expect(';', 'after the for-loop start');
      } else if (!at(';')) {
        const e = parseExpr();
        if (at(',')) fail('The comma operator in for(…) is not supported: use one counter, or update the second one inside the loop.');
        init = { k: 'expr', expr: e, line: t.line, col: t.col };
        expect(';', 'after the for-loop start');
      } else i++;
      const test = at(';') ? null : parseExpr();
      expect(';', 'after the for-loop condition');
      const update = at(')') ? null : parseExpr();
      if (at(',')) fail('The comma operator in for(…) is not supported: use one counter, or update the second one inside the loop.');
      expect(')', 'to close for(…)');
      return { k: 'for', init, test, update, body: parseStmt(), line: t.line, col: t.col };
    }
    if (at('switch')) {
      i++; expect('(');
      const disc = parseExpr(); expect(')'); expect('{', 'to open the switch');
      const cases: { test: Expr | null; body: Stmt[]; line: number }[] = [];
      while (!at('}')) {
        const c = peek();
        if (at('case')) { i++; const test = parseCond(); expect(':', 'after case'); cases.push({ test, body: [], line: c.line }); }
        else if (at('default')) { i++; expect(':', 'after default'); cases.push({ test: null, body: [], line: c.line }); }
        else {
          if (!cases.length) fail('Statements inside switch must follow a case label.');
          cases[cases.length - 1].body.push(parseStmt());
        }
      }
      expect('}');
      return { k: 'switch', disc, cases, line: t.line, col: t.col };
    }
    if (at('break')) { i++; expect(';'); return { k: 'break', line: t.line, col: t.col }; }
    if (at('continue')) { i++; expect(';'); return { k: 'continue', line: t.line, col: t.col }; }
    if (at('return')) {
      i++;
      const value = at(';') ? undefined : parseExpr();
      expect(';', 'after return');
      return { k: 'return', value, line: t.line, col: t.col };
    }
    // a declaration: a type followed by a name (or *name)
    if (isTypeStart() && !(TYPE_WORDS.has(t.text) && at('(', 1))) {
      const type = parseType();
      const decls = parseDeclarators(type);
      expect(';', 'after the declaration');
      return { k: 'var', type, decls, line: t.line, col: t.col };
    }
    const expr = parseExpr();
    expect(';', 'at the end of the statement');
    return { k: 'expr', expr, line: t.line, col: t.col };
  }

  function parseBlock(): Stmt & { k: 'block' } {
    const t = expect('{');
    const body: Stmt[] = [];
    while (!at('}')) {
      if (peek().kind === 'eof') fail('A { is never closed with }.', t);
      body.push(guard(parseStmt, () => skipTo([';', '}'], true)));
    }
    i++;
    return { k: 'block', body, line: t.line, col: t.col };
  }

  function skipTo(stops: string[], consumeSemi: boolean) {
    let depth = 0;
    while (peek().kind !== 'eof') {
      const t = peek();
      if (t.text === '{') depth++;
      if (t.text === '}') { if (depth === 0) return; depth--; }
      if (depth === 0 && stops.includes(t.text) && t.kind === 'punct') { if (t.text === ';' && consumeSemi) i++; return; }
      i++;
    }
  }

  function guard<T>(fn: () => T, recover: () => void): T {
    const start = i;
    try { return fn(); } catch (e) {
      if (!(e instanceof CompileError)) throw e;
      diags.push(e.diag);
      if (i === start) i++;
      recover();
      return { k: 'empty', line: e.diag.line, col: e.diag.col } as unknown as T;
    }
  }

  function parseTop(): FuncDecl | GlobalDecl | null {
    const t = peek();
    if (t.kind === 'id' && UNSUPPORTED_KEYWORDS[t.text]) fail(UNSUPPORTED_KEYWORDS[t.text]);
    if (at(';')) { i++; return null; }
    const type = parseType();
    const n = peek();
    if (n.kind === 'id' && at('(', 1) && !classes.has(type.base)) {
      // function definition or prototype
      i += 2;
      const params: Param[] = [];
      if (at('void') && at(')', 1)) i++;
      if (!at(')')) {
        do {
          if (at('...')) fail('Variadic functions are not supported.');
          const pt = parseType();
          const pn = peek();
          if (pn.kind !== 'id') fail(`Expected a parameter name but found ${describe(pn)}.`);
          i++;
          const dims: (Expr | null)[] = [];
          while (at('[')) { i++; dims.push(at(']') ? null : parseExpr()); expect(']'); }
          if (at('=')) fail('Default parameter values are not supported.');
          params.push({ type: pt, name: pn.text, dims, line: pn.line, col: pn.col });
        } while (at(',') && ++i);
      }
      expect(')', 'to close the parameter list');
      if (at(';')) { i++; return { k: 'func', ret: type, name: n.text, params, body: null, line: n.line, col: n.col, endLine: n.line }; }
      const body = parseBlock();
      return { k: 'func', ret: type, name: n.text, params, body, line: n.line, col: n.col, endLine: tokens[i - 1].line };
    }
    const decls = parseDeclarators(type);
    expect(';', 'after the declaration');
    return { k: 'global', type, decls, line: t.line, col: t.col };
  }

  const items: (FuncDecl | GlobalDecl)[] = [];
  while (peek().kind !== 'eof') {
    const item = guard(parseTop, () => skipTo([';', '}'], true));
    if (item && (item as { k: string }).k !== 'empty') items.push(item);
    else if (at('}')) i++;
  }
  return { items };
}
