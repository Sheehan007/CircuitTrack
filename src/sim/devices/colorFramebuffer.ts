import { glyph } from './font5x7';

/** "#rrggbb" → [r, g, b], quantised to 16-bit colour (RGB565) like the panel does. */
export function rgb565(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16) || 0;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const q = (v: number, bits: number) => Math.round(Math.round((v / 255) * ((1 << bits) - 1)) * (255 / ((1 << bits) - 1)));
  return [q(r, 5), q(g, 6), q(b, 5)];
}

export interface Sprite { w: number; h: number; /** "#rrggbb" per pixel, or null for transparent. */ px: (string | null)[] }

/** RGB framebuffer with the GFX-style drawing calls of colour TFT libraries. commit() shows the drawing. */
export class ColorFramebuffer {
  readonly buf: Uint8ClampedArray;
  readonly shown: Uint8ClampedArray;
  frame = 0;

  constructor(readonly width: number, readonly height: number) {
    this.buf = new Uint8ClampedArray(width * height * 4);
    this.shown = new Uint8ClampedArray(width * height * 4);
    this.fill('#000000');
    this.shown.set(this.buf);
  }

  pixel(x: number, y: number, c: [number, number, number]) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.buf[i] = c[0]; this.buf[i + 1] = c[1]; this.buf[i + 2] = c[2]; this.buf[i + 3] = 255;
  }

  fill(hex: string) { this.fillRect(0, 0, this.width, this.height, hex); }

  /** One pixel from a 16-bit RGB565 colour (what TFT libraries send), without the hex round-trip. */
  px565(x: number, y: number, c: number) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.buf[i] = Math.round((((c >> 11) & 31) * 255) / 31);
    this.buf[i + 1] = Math.round((((c >> 5) & 63) * 255) / 63);
    this.buf[i + 2] = Math.round(((c & 31) * 255) / 31);
    this.buf[i + 3] = 255;
  }

  fillRect(x: number, y: number, w: number, h: number, hex: string) {
    const c = rgb565(hex);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.pixel(x + i, y + j, c);
  }

  rect(x: number, y: number, w: number, h: number, hex: string) {
    const c = rgb565(hex);
    for (let i = 0; i < w; i++) { this.pixel(x + i, y, c); this.pixel(x + i, y + h - 1, c); }
    for (let j = 0; j < h; j++) { this.pixel(x, y + j, c); this.pixel(x + w - 1, y + j, c); }
  }

  line(x0: number, y0: number, x1: number, y1: number, hex: string) {
    const c = rgb565(hex);
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 4096; guard++) {
      this.pixel(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  circle(cx: number, cy: number, r: number, hex: string, filled: boolean) {
    const c = rgb565(hex);
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const d = x * x + y * y;
      if (filled ? d <= r * r + r : Math.abs(Math.sqrt(d) - r) < 0.6) this.pixel(cx + x, cy + y, c);
    }
  }

  text(x: number, y: number, str: string, size: number, hex: string) {
    const c = rgb565(hex), s = Math.max(1, Math.round(size));
    let cx = x;
    for (const ch of str) {
      if (ch === '\n') { y += 8 * s; cx = x; continue; }
      const cols = glyph(ch);
      for (let k = 0; k < 5; k++) for (let r = 0; r < 8; r++) {
        if ((cols[k] >> r) & 1) for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) this.pixel(cx + k * s + i, y + r * s + j, c);
      }
      cx += 6 * s;
    }
    return cx;
  }

  sprite(sp: Sprite, x: number, y: number, scale = 1) {
    const s = Math.max(1, Math.round(scale));
    for (let j = 0; j < sp.h; j++) for (let i = 0; i < sp.w; i++) {
      const hex = sp.px[j * sp.w + i];
      if (!hex) continue;
      const c = rgb565(hex);
      for (let b = 0; b < s; b++) for (let a = 0; a < s; a++) this.pixel(x + i * s + a, y + j * s + b, c);
    }
  }

  commit() { this.shown.set(this.buf); this.frame++; }

  reset() { this.fill('#000000'); this.shown.set(this.buf); this.frame++; }

  /** Colour of a shown pixel as "#rrggbb" (tests). */
  at(x: number, y: number) {
    const i = (y * this.width + x) * 4;
    return '#' + [0, 1, 2].map((k) => this.shown[i + k].toString(16).padStart(2, '0')).join('');
  }
}
