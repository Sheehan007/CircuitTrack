/*
  Adafruit-GFX-style drawing for the display libraries the sketches use (SSD1306, ST7735): text cursor, size, colours
  with optional background, wrapping, rotation, and the usual primitives. It draws through a pixel callback, so the
  same code serves the 1-bit OLED buffer and the 16-bit TFT.
*/
import { glyph } from '../devices/font5x7';

export class Gfx {
  cursorX = 0;
  cursorY = 0;
  textSize = 1;
  textColor = 1;
  textBg: number | null = null;
  wrap = true;
  rotation = 0;
  cp437 = false;

  constructor(readonly rawW: number, readonly rawH: number, private setRaw: (x: number, y: number, color: number) => void) {}

  get width() { return this.rotation % 2 ? this.rawH : this.rawW; }
  get height() { return this.rotation % 2 ? this.rawW : this.rawH; }

  pixel(x: number, y: number, c: number) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    let rx = x, ry = y;
    switch (this.rotation & 3) {
      case 1: rx = this.rawW - 1 - y; ry = x; break;
      case 2: rx = this.rawW - 1 - x; ry = this.rawH - 1 - y; break;
      case 3: rx = y; ry = this.rawH - 1 - x; break;
    }
    this.setRaw(rx, ry, c);
  }

  fillRect(x: number, y: number, w: number, h: number, c: number) {
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + w)), y1 = Math.min(this.height, Math.round(y + h));
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) this.pixel(i, j, c);
  }

  fillScreen(c: number) { this.fillRect(0, 0, this.width, this.height, c); }

  hline(x: number, y: number, w: number, c: number) { this.fillRect(x, y, w, 1, c); }
  vline(x: number, y: number, h: number, c: number) { this.fillRect(x, y, 1, h, c); }

  rect(x: number, y: number, w: number, h: number, c: number) {
    this.hline(x, y, w, c); this.hline(x, y + h - 1, w, c); this.vline(x, y, h, c); this.vline(x + w - 1, y, h, c);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: number) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 8192; guard++) {
      this.pixel(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  circle(cx: number, cy: number, r: number, c: number, filled: boolean) {
    r = Math.max(0, Math.round(r));
    let x = r, y = 0, err = 1 - r;
    while (x >= y) {
      if (filled) {
        this.hline(cx - x, cy + y, 2 * x + 1, c); this.hline(cx - x, cy - y, 2 * x + 1, c);
        this.hline(cx - y, cy + x, 2 * y + 1, c); this.hline(cx - y, cy - x, 2 * y + 1, c);
      } else {
        for (const [px, py] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]]) this.pixel(cx + px, cy + py, c);
      }
      y++;
      if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
    }
  }

  roundRect(x: number, y: number, w: number, h: number, r: number, c: number, filled: boolean) {
    r = Math.min(r, Math.floor(Math.min(w, h) / 2));
    if (filled) {
      this.fillRect(x + r, y, w - 2 * r, h, c);
      this.fillRect(x, y + r, r, h - 2 * r, c);
      this.fillRect(x + w - r, y + r, r, h - 2 * r, c);
      for (const [cx, cy] of [[x + r, y + r], [x + w - r - 1, y + r], [x + r, y + h - r - 1], [x + w - r - 1, y + h - r - 1]]) this.circle(cx, cy, r, c, true);
    } else {
      this.hline(x + r, y, w - 2 * r, c); this.hline(x + r, y + h - 1, w - 2 * r, c);
      this.vline(x, y + r, h - 2 * r, c); this.vline(x + w - 1, y + r, h - 2 * r, c);
      for (const [cx, cy] of [[x + r, y + r], [x + w - r - 1, y + r], [x + r, y + h - r - 1], [x + w - r - 1, y + h - r - 1]]) this.circle(cx, cy, r, c, false);
    }
  }

  triangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: number, filled: boolean) {
    if (!filled) { this.line(x0, y0, x1, y1, c); this.line(x1, y1, x2, y2, c); this.line(x2, y2, x0, y0, c); return; }
    const minY = Math.round(Math.min(y0, y1, y2)), maxY = Math.round(Math.max(y0, y1, y2));
    const edges: [number, number, number, number][] = [[x0, y0, x1, y1], [x1, y1, x2, y2], [x2, y2, x0, y0]];
    for (let y = minY; y <= maxY; y++) {
      const xs: number[] = [];
      for (const [ax, ay, bx, by] of edges) {
        if ((y >= ay && y <= by) || (y >= by && y <= ay)) {
          if (ay === by) xs.push(ax, bx); else xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
        }
      }
      if (xs.length) this.hline(Math.min(...xs), y, Math.max(...xs) - Math.min(...xs) + 1, c);
    }
  }

  /** One character at the cursor, Adafruit-GFX classic font metrics (6 × 8 per size step). */
  private char(ch: number) {
    const s = this.textSize;
    if (ch === 10) { this.cursorX = 0; this.cursorY += 8 * s; return; }
    if (ch === 13) return;
    if (this.wrap && this.cursorX + 6 * s > this.width) { this.cursorX = 0; this.cursorY += 8 * s; }
    // the classic GFX font puts ° at 247 when cp437(true), at 248 otherwise; accept both and the Unicode °
    const glyphChar = ch === 247 || ch === 248 || ch === 176 ? '°' : String.fromCharCode(ch);
    const cols = glyph(glyphChar);
    for (let i = 0; i < 6; i++) {
      const col = i < 5 ? cols[i] : 0;
      for (let j = 0; j < 8; j++) {
        const on = (col >> j) & 1;
        if (on) this.fillRect(this.cursorX + i * s, this.cursorY + j * s, s, s, this.textColor);
        else if (this.textBg != null) this.fillRect(this.cursorX + i * s, this.cursorY + j * s, s, s, this.textBg);
      }
    }
    this.cursorX += 6 * s;
  }

  write(text: string) {
    for (const c of text) this.char(c === '°' ? 247 : c.charCodeAt(0) & 0xff);
  }
}

/** RGB565 → "#rrggbb" and back. */
export const rgb565ToHex = (c: number) => {
  const r = ((c >> 11) & 31) * 255 / 31, g = ((c >> 5) & 63) * 255 / 63, b = (c & 31) * 255 / 31;
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
};
export const color565 = (r: number, g: number, b: number) => ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
