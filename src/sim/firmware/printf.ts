import { toText, type Kind } from './types';

/** Arduino Print semantics for print(x) / print(x, fmt): integers in a base, floats with N decimals, chars as text. */
export function formatPrint(v: unknown, kind: Kind, fmt?: number): string {
  if (kind === 'str') return String(v);
  if (kind === 'f32' || kind === 'f64') return toText(v, kind, fmt ?? 2);
  if (kind === 'char' && fmt == null) return String.fromCharCode((v as number) & 0xff);
  const n = v as number;
  if (fmt != null && fmt !== 10 && [2, 8, 16].includes(fmt)) {
    // negative numbers print as their unsigned 32-bit pattern, like the real Print class
    return (n < 0 ? n >>> 0 : n).toString(fmt).toUpperCase();
  }
  return String(n);
}

const SPEC = /%([-0+ ]*)(\d+)?(?:\.(\d+))?(?:hh|h|ll|l|z)?([diuxXocsfFeEgG%])/g;

/** A practical printf: %d %i %u %ld %lu %x %X %o %c %s %f %.Nf %e %g %% with width, '-', '+' and '0' flags. */
export function formatPrintf(fmt: string, args: unknown[]): string {
  let i = 0;
  return fmt.replace(SPEC, (_m, flags: string, width: string | undefined, prec: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const v = args[i++];
    const n = Number(v);
    let s: string;
    switch (conv) {
      case 'd': case 'i': s = String(Math.trunc(n)); break;
      case 'u': s = String(n < 0 ? n >>> 0 : Math.trunc(n)); break;
      case 'x': s = (n >>> 0).toString(16); break;
      case 'X': s = (n >>> 0).toString(16).toUpperCase(); break;
      case 'o': s = (n >>> 0).toString(8); break;
      case 'c': s = String.fromCharCode(n & 0xff); break;
      case 's': s = String(v); break;
      case 'e': case 'E': s = n.toExponential(prec != null ? Number(prec) : 6); if (conv === 'E') s = s.toUpperCase(); break;
      case 'g': case 'G': s = String(Number(n.toPrecision(prec != null ? Math.max(1, Number(prec)) : 6))); break;
      default: s = Number.isNaN(n) ? 'nan' : n.toFixed(prec != null ? Number(prec) : 6);
    }
    if (prec != null && conv === 's') s = s.slice(0, Number(prec));
    if (flags.includes('+') && /[dif]/.test(conv) && !s.startsWith('-')) s = '+' + s;
    const w = width ? Number(width) : 0;
    if (s.length < w) {
      if (flags.includes('-')) s = s.padEnd(w);
      else if (flags.includes('0') && !/[sc]/.test(conv)) s = s.startsWith('-') ? '-' + s.slice(1).padStart(w - 1, '0') : s.padStart(w, '0');
      else s = s.padStart(w);
    }
    return s;
  });
}
