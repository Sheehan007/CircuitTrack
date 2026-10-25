import { glyph } from './font5x7';

/**
 * A 1-bit framebuffer with the drawing calls beginners meet in Adafruit-GFX style libraries.
 * Like the real driver, drawing goes into a buffer; `commit()` copies it to what the panel shows.
 */
export class MonoFramebuffer {
  readonly buf: Uint8Array;
  readonly shown: Uint8Array;
  /** Increments on every commit so renderers know when to repaint. */
  frame = 0;

  constructor(readonly width: number, readonly height: number) {
    this.buf = new Uint8Array(width * height);
    this.shown = new Uint8Array(width * height);
  }

  clear() { this.buf.fill(0); }

  pixel(x: number, y: number, on = 1) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.buf[y * this.width + x] = on ? 1 : 0;
  }

  fillRect(x: number, y: number, w: number, h: number, on = 1) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.pixel(x + i, y + j, on);
  }

  rect(x: number, y: number, w: number, h: number, on = 1) {
    for (let i = 0; i < w; i++) { this.pixel(x + i, y, on); this.pixel(x + i, y + h - 1, on); }
    for (let j = 0; j < h; j++) { this.pixel(x, y + j, on); this.pixel(x + w - 1, y + j, on); }
  }

  line(x0: number, y0: number, x1: number, y1: number, on = 1) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 4096; guard++) {
      this.pixel(x0, y0, on);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  /** Text at (x, y) = top-left of the first cell; size scales each font pixel. Returns the x after the text. */
  text(x: number, y: number, str: string, size = 1, on = 1) {
    const s = Math.max(1, Math.round(size));
    let cx = x;
    for (const ch of str) {
      if (ch === '\n') { y += 8 * s; cx = x; continue; }
      const cols = glyph(ch);
      for (let c = 0; c < 5; c++) {
        for (let r = 0; r < 8; r++) {
          if ((cols[c] >> r) & 1) {
            if (s === 1) this.pixel(cx + c, y + r, on);
            else this.fillRect(cx + c * s, y + r * s, s, s, on);
          }
        }
      }
      cx += 6 * s;
    }
    return cx;
  }

  commit() {
    this.shown.set(this.buf);
    this.frame++;
  }

  /** Lit pixels in the shown image (handy for tests). */
  litCount() { let n = 0; for (const v of this.shown) n += v; return n; }

  reset() { this.buf.fill(0); this.shown.fill(0); this.frame++; }
}

/** The text a given call would draw, rendered alone, for comparing in tests. */
export function renderText(str: string, size = 1) {
  const fb = new MonoFramebuffer(Math.max(1, str.length * 6 * size), 8 * size);
  fb.text(0, 0, str, size);
  fb.commit();
  return fb;
}
