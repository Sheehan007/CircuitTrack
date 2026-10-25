// Static types of the Arduino-C++ subset, and the C conversion rules the compiler and VM share.

export type NumKind = 'bool' | 'char' | 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32' | 'i64' | 'u64' | 'f32' | 'f64';

export type CType =
  | { k: 'num'; n: NumKind }
  /** Arduino String object. */
  | { k: 'String' }
  /** C text (string literal / const char*): no + concatenation. */
  | { k: 'cstr' }
  | { k: 'void' }
  | { k: 'obj'; cls: string }
  | { k: 'arr'; of: CType; len: number };

export const T = {
  void: { k: 'void' } as CType,
  bool: { k: 'num', n: 'bool' } as CType,
  char: { k: 'num', n: 'char' } as CType,
  i32: { k: 'num', n: 'i32' } as CType,
  u32: { k: 'num', n: 'u32' } as CType,
  i64: { k: 'num', n: 'i64' } as CType,
  u8: { k: 'num', n: 'u8' } as CType,
  f32: { k: 'num', n: 'f32' } as CType,
  f64: { k: 'num', n: 'f64' } as CType,
  String: { k: 'String' } as CType,
  cstr: { k: 'cstr' } as CType,
};

/** Every kind the VM converts between, by index (used in CONV / BIN / CMP operands). */
export const KINDS = ['bool', 'char', 'i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'i64', 'u64', 'f32', 'f64', 'str'] as const;
export type Kind = (typeof KINDS)[number];
export const KI = Object.fromEntries(KINDS.map((k, i) => [k, i])) as Record<Kind, number>;

export const BASE_TYPES: Record<string, CType> = {
  void: T.void, bool: T.bool, char: T.char, 'signed char': { k: 'num', n: 'i8' }, 'unsigned char': T.u8, byte: T.u8, uint8_t: T.u8, int8_t: { k: 'num', n: 'i8' },
  short: { k: 'num', n: 'i16' }, int16_t: { k: 'num', n: 'i16' }, 'unsigned short': { k: 'num', n: 'u16' }, uint16_t: { k: 'num', n: 'u16' }, word: { k: 'num', n: 'u16' },
  int: T.i32, long: T.i32, int32_t: T.i32, 'unsigned int': T.u32, 'unsigned long': T.u32, uint32_t: T.u32, size_t: T.u32,
  'long long': T.i64, int64_t: T.i64, 'unsigned long long': { k: 'num', n: 'u64' }, uint64_t: { k: 'num', n: 'u64' },
  float: T.f32, double: T.f64, String: T.String,
};

export const SIZEOF: Record<NumKind, number> = { bool: 1, char: 1, i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, i64: 8, u64: 8, f32: 4, f64: 8 };

export const isNum = (t: CType): t is { k: 'num'; n: NumKind } => t.k === 'num';
export const isText = (t: CType) => t.k === 'String' || t.k === 'cstr';
export const isFloat = (n: NumKind) => n === 'f32' || n === 'f64';
export const kindOf = (t: CType): Kind => (t.k === 'num' ? t.n : 'str');

export function typeName(t: CType): string {
  switch (t.k) {
    case 'num': return ({ bool: 'bool', char: 'char', i8: 'int8_t', u8: 'byte', i16: 'int16_t', u16: 'uint16_t', i32: 'int', u32: 'unsigned long', i64: 'long long', u64: 'uint64_t', f32: 'float', f64: 'double' } as const)[t.n];
    case 'String': return 'String';
    case 'cstr': return 'const char*';
    case 'void': return 'void';
    case 'obj': return t.cls;
    case 'arr': return `${typeName(t.of)}[${t.len}]`;
  }
}

/** C "usual arithmetic conversions" for two numeric operands. */
export function arith(a: NumKind, b: NumKind): NumKind {
  if (a === 'f64' || b === 'f64') return 'f64';
  if (a === 'f32' || b === 'f32') return 'f32';
  const rank = (n: NumKind) => (n === 'u64' ? 4 : n === 'i64' ? 3 : n === 'u32' ? 2 : 1);
  const r = Math.max(rank(a), rank(b));
  return r === 4 ? 'u64' : r === 3 ? 'i64' : r === 2 ? 'u32' : 'i32';
}

/** Convert a JS number to a C numeric kind (wrap-around for integers, like the hardware). */
export function conv(v: number, n: NumKind): number {
  if (n === 'f64') return v;
  if (n === 'f32') return Math.fround(v);
  if (n === 'bool') return v ? 1 : 0;
  if (!Number.isFinite(v)) v = 0;
  v = Math.trunc(v);
  switch (n) {
    case 'i32': return v | 0;
    case 'u32': return v >>> 0;
    case 'char': case 'i8': return (v << 24) >> 24;
    case 'u8': return v & 0xff;
    case 'i16': return (v << 16) >> 16;
    case 'u16': return v & 0xffff;
    default: return v; // 64-bit kinds keep JS precision (53 bits)
  }
}

/** Arduino String(x) formatting for a value of a given kind. */
export function toText(v: unknown, kind: Kind, decimals = 2): string {
  if (kind === 'str') return String(v);
  const n = v as number;
  if (kind === 'char') return String.fromCharCode(n & 0xff);
  if (kind === 'f32' || kind === 'f64') {
    if (Number.isNaN(n)) return 'nan';
    if (!Number.isFinite(n)) return n > 0 ? 'inf' : '-inf';
    return n.toFixed(decimals);
  }
  return String(n);
}
