/*
  Half-size solderless breadboard (400 tie points): 30 columns, rows a–e and f–j either side of the centre channel,
  and a + / − rail pair along each long edge (25 holes each, in groups of five).
  Inside, each column's a–e holes are one strip, f–j another, and each rail is one long strip. Leaded parts dropped
  onto the board plug their legs into the holes underneath (see netlist.ts: insertions).
*/
import type { ComponentDef, TerminalDef } from './types';

export const BB = { pitch: 2.54, cols: 30, top: 8.5, halfX: 41.3, halfY: 27.3 };
export const ROWS_TOP = ['a', 'b', 'c', 'd', 'e'];
export const ROWS_BOTTOM = ['f', 'g', 'h', 'i', 'j'];
const colX = (c: number) => (c - 15.5) * BB.pitch;
const rowY: Record<string, number> = { a: 13.97, b: 11.43, c: 8.89, d: 6.35, e: 3.81, f: -3.81, g: -6.35, h: -8.89, i: -11.43, j: -13.97 };
const RAIL_COLS = Array.from({ length: 30 }, (_, i) => i + 1).filter((c) => c > 1 && (c - 1) % 6 !== 0);
export const RAILS: { id: string; y: number; label: string; sign: '+' | '−' }[] = [
  { id: 'TN', y: 21.59, label: 'top − rail', sign: '−' },
  { id: 'TP', y: 19.05, label: 'top + rail', sign: '+' },
  { id: 'BP', y: -19.05, label: 'bottom + rail', sign: '+' },
  { id: 'BN', y: -21.59, label: 'bottom − rail', sign: '−' },
];

const terms: TerminalDef[] = [];
const shorts: [string, string][] = [];
for (let c = 1; c <= BB.cols; c++) {
  for (const group of [ROWS_TOP, ROWS_BOTTOM]) {
    group.forEach((r, k) => {
      terms.push({ id: `${r}${c}`, label: `hole ${r}${c}`, pos: [colX(c), rowY[r], BB.top], kind: 'passive', description: `Column ${c}, row ${r}: joined to ${group[0]}${c}–${group[4]}${c}.` });
      if (k) shorts.push([`${group[k - 1]}${c}`, `${r}${c}`]);
    });
  }
}
for (const rail of RAILS) {
  RAIL_COLS.forEach((c, k) => {
    terms.push({ id: `${rail.id}${c}`, label: `${rail.label} (${rail.sign})`, pos: [colX(c), rail.y, BB.top], kind: 'passive', description: `The ${rail.label}: every hole along it is joined.` });
    if (k) shorts.push([`${rail.id}${RAIL_COLS[k - 1]}`, `${rail.id}${c}`]);
  });
}

/** Which strip a hole belongs to, e.g. "a5" → "5a–e", "TP12" → "top + rail". */
export function stripOf(id: string) {
  const rail = RAILS.find((r) => id.startsWith(r.id));
  if (rail) return rail.label;
  const m = id.match(/^([a-j])(\d+)$/);
  if (!m) return id;
  return ROWS_TOP.includes(m[1]) ? `column ${m[2]} a–e` : `column ${m[2]} f–j`;
}

export const breadboard: ComponentDef = {
  type: 'breadboard',
  name: 'Breadboard (half size, 400 points)',
  category: 'Prototyping',
  summary: 'Drop LEDs, resistors, buttons and other leaded parts onto it: their legs plug into the holes. Each column of five (a–e, f–j) is joined inside, and so is each rail.',
  status: 'ready',
  labelPrefix: 'Breadboard',
  bounds: [[-BB.halfX, -BB.halfY, 0], [BB.halfX, BB.halfY, BB.top]],
  terminals: terms,
  internalShorts: shorts,
  params: [],
  defaults: {},
  electrical: () => [],
  specs: () => [['Tie points', '400 (300 + 4 rails × 25)'], ['Pitch', '2.54 mm (0.1")'], ['Strips', 'a–e and f–j per column; rails along each edge'], ['Note', 'the DOIT DevKit is too wide to sit on it: wire it with jumpers']],
  alt: () => 'White half-size breadboard with 30 numbered columns, rows a to j split by a centre channel, and red and blue power rails along both long edges.',
};
