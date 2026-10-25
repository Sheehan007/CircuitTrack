/*
  Preprocessor + lexer for the supported Arduino-C++ subset.

  Preprocessor: comments, #include (recorded, checked later), object-like #define, #ifdef / #ifndef / #else / #endif,
  #pragma (ignored). Function-like macros and #if expressions are reported as unsupported. Line numbers are preserved
  so diagnostics and the running-line highlight point at the user's source.
*/
import type { Diagnostic } from './diagnostics';

export type TokKind = 'id' | 'num' | 'str' | 'char' | 'punct' | 'eof';

export interface Token {
  kind: TokKind;
  text: string;
  /** Numeric value for num/char tokens. */
  value?: number;
  /** Literal kind for numbers: integer (with unsigned/long flags) or floating (with float flag). */
  numKind?: { float: boolean; f32?: boolean; unsigned?: boolean; long?: boolean };
  line: number;
  col: number;
}

export interface Include { name: string; line: number }

const PUNCT = [
  '<<=', '>>=', '...', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '::',
  '+', '-', '*', '/', '%', '<', '>', '=', '!', '&', '|', '^', '~', '?', ':', ';', ',', '.', '(', ')', '[', ']', '{', '}', '#',
];

/** Strip comments, keeping newlines so line numbers stay put. */
function stripComments(src: string, diags: Diagnostic[]): string {
  let out = '';
  let i = 0;
  let line = 1;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '"' || c === "'") {
      const q = c;
      out += c; i++;
      while (i < src.length && src[i] !== q && src[i] !== '\n') { if (src[i] === '\\') { out += src[i++]; } out += src[i++]; }
      if (i < src.length && src[i] === q) out += src[i++];
      continue;
    }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') {
      const start = line;
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') { out += '\n'; line++; } i++; }
      if (i >= src.length) diags.push({ line: start, col: 1, severity: 'error', message: 'This /* comment is never closed.' });
      i += 2;
      out += ' ';
      continue;
    }
    if (c === '\n') line++;
    out += c; i++;
  }
  return out;
}

export interface Preprocessed { tokens: Token[]; includes: Include[] }

export function preprocess(source: string, diags: Diagnostic[]): Preprocessed {
  const text = stripComments(source.replace(/\r\n?/g, '\n'), diags);
  const lines = text.split('\n');
  const macros = new Map<string, { tokens: Token[]; line: number }>();
  // attributes that are empty on the ESP32 (flash/IRAM placement) and ESP32 target macros
  for (const name of ['PROGMEM', 'IRAM_ATTR', 'ARDUINO_ISR_ATTR', 'DRAM_ATTR', 'RTC_DATA_ATTR']) macros.set(name, { tokens: [], line: 0 });
  for (const name of ['ESP32', 'ARDUINO_ARCH_ESP32']) macros.set(name, { tokens: lex('1', 0, diags), line: 0 });
  const includes: Include[] = [];
  const tokens: Token[] = [];
  // #ifdef nesting: each entry says whether that branch is active
  const cond: { active: boolean; taken: boolean; line: number }[] = [];
  const active = () => cond.every((c) => c.active);

  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    const m = raw.match(/^\s*#\s*(\w+)\s*(.*)$/);
    if (m) {
      const [, dir, rest] = m;
      switch (dir) {
        case 'ifdef':
        case 'ifndef': {
          const name = rest.trim().split(/\s+/)[0];
          const has = macros.has(name);
          const on = dir === 'ifdef' ? has : !has;
          cond.push({ active: on, taken: on, line: lineNo });
          return;
        }
        case 'else': {
          const top = cond[cond.length - 1];
          if (!top) diags.push({ line: lineNo, col: 1, severity: 'error', message: '#else without #ifdef / #ifndef.' });
          else { top.active = !top.taken; top.taken = true; }
          return;
        }
        case 'endif':
          if (!cond.pop()) diags.push({ line: lineNo, col: 1, severity: 'error', message: '#endif without #ifdef / #ifndef.' });
          return;
        case 'if':
        case 'elif':
          diags.push({ line: lineNo, col: 1, severity: 'error', message: `#${dir} with an expression is not supported; use #ifdef / #ifndef.` });
          cond.push({ active: false, taken: false, line: lineNo });
          return;
      }
      if (!active()) return;
      switch (dir) {
        case 'include': {
          const inc = rest.match(/^[<"]([^>"]+)[>"]/);
          if (inc) includes.push({ name: inc[1].trim(), line: lineNo });
          else diags.push({ line: lineNo, col: 1, severity: 'error', message: 'Write includes as #include <Library.h>.' });
          return;
        }
        case 'define': {
          const d = rest.match(/^([A-Za-z_]\w*)(\()?(.*)$/);
          if (!d) { diags.push({ line: lineNo, col: 1, severity: 'error', message: '#define needs a name.' }); return; }
          if (d[2]) { diags.push({ line: lineNo, col: 1, severity: 'error', message: `Function-like macros (#define ${d[1]}(...)) are not supported. Write a small function instead.` }); return; }
          macros.set(d[1], { tokens: lex(d[3], lineNo, diags), line: lineNo });
          return;
        }
        case 'undef': macros.delete(rest.trim()); return;
        case 'pragma': return;
        default:
          diags.push({ line: lineNo, col: 1, severity: 'error', message: `#${dir} is not supported.` });
          return;
      }
    }
    if (!active()) return;
    const toks = lex(raw, lineNo, diags);
    // expand object-like macros (recursively, guarding against self-reference)
    const expand = (t: Token, seen: Set<string>): Token[] => {
      const mac = t.kind === 'id' ? macros.get(t.text) : undefined;
      if (!mac || seen.has(t.text)) return [t];
      const s2 = new Set(seen).add(t.text);
      return mac.tokens.flatMap((mt) => expand({ ...mt, line: t.line, col: t.col }, s2));
    };
    for (const t of toks) tokens.push(...expand(t, new Set()));
  });
  for (const c of cond) diags.push({ line: c.line, col: 1, severity: 'error', message: 'This #ifdef / #ifndef has no #endif.' });
  tokens.push({ kind: 'eof', text: '', line: lines.length, col: 1 });
  // adjacent string literals concatenate ("a" "b" → "ab")
  const merged: Token[] = [];
  for (const t of tokens) {
    const prev = merged[merged.length - 1];
    if (t.kind === 'str' && prev?.kind === 'str') prev.text += t.text;
    else merged.push(t);
  }
  return { tokens: merged, includes };
}

const ESC: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', f: '\f', v: '\v' };

function unescape(s: string, line: number, col: number, diags: Diagnostic[]) {
  return s.replace(/\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3}|.)/g, (_, e: string) => {
    if (e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
    if (/^[0-7]+$/.test(e) && e !== '0') return String.fromCharCode(parseInt(e, 8));
    if (e in ESC) return ESC[e];
    diags.push({ line, col, severity: 'warning', message: `Unknown escape \\${e}.` });
    return e;
  });
}

export function lex(src: string, line: number, diags: Diagnostic[]): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const col = i + 1;
    if (/\s/.test(c)) { i++; continue; }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /\w/.test(src[j])) j++;
      out.push({ kind: 'id', text: src.slice(i, j), line, col });
      i = j;
      continue;
    }
    if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] ?? ''))) {
      const m = src.slice(i).match(/^(0[xX][0-9a-fA-F']+|0[bB][01']+|(?:\d[\d']*\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([uUlLfF]*)/)!;
      const body = m[1].replace(/'/g, ''), suf = m[2].toLowerCase();
      let value: number, isFloat = false;
      if (/^0x/i.test(body)) value = parseInt(body.slice(2), 16);
      else if (/^0b/i.test(body)) value = parseInt(body.slice(2), 2);
      else if (/[.eE]/.test(body) || suf.includes('f')) { value = parseFloat(body); isFloat = true; }
      else if (/^0\d+$/.test(body)) value = parseInt(body, 8);
      else value = parseInt(body, 10);
      out.push({ kind: 'num', text: m[0], value, numKind: { float: isFloat, f32: isFloat && suf.includes('f'), unsigned: suf.includes('u'), long: suf.includes('l') }, line, col });
      i += m[0].length;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') { if (src[j] === '\\') j++; j++; }
      if (j >= src.length) diags.push({ line, col, severity: 'error', message: 'This string is never closed with ".' });
      out.push({ kind: 'str', text: unescape(src.slice(i + 1, j), line, col, diags), line, col });
      i = j + 1;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== "'") { if (src[j] === '\\') j++; j++; }
      const body = unescape(src.slice(i + 1, j), line, col, diags);
      if (body.length !== 1) diags.push({ line, col, severity: 'error', message: "A character literal holds exactly one character, like 'A'. Use \"...\" for text." });
      out.push({ kind: 'char', text: body, value: body.charCodeAt(0) || 0, line, col });
      i = j + 1;
      continue;
    }
    const p = PUNCT.find((q) => src.startsWith(q, i));
    if (p) { out.push({ kind: 'punct', text: p, line, col }); i += p.length; continue; }
    diags.push({ line, col, severity: 'error', message: `Unexpected character '${c}'.` });
    i++;
  }
  return out;
}
