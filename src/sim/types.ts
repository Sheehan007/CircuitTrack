// Shared types for the headless simulation core. Nothing in src/sim may import from the DOM or the figure layer.

export type V3 = [number, number, number];

/** A terminal on a placed part: the board's header pins use part id "esp32". */
export interface TermRef {
  part: string;
  term: string;
}

export const termKey = (t: TermRef) => `${t.part}:${t.term}`;

export interface PartInstance {
  id: string;
  type: string;
  label: string;
  /** Workspace position in mm (ground plane). */
  x: number;
  y: number;
  /** Quarter turns about the vertical axis, 0–3. */
  rot: number;
  /** Height of the part's base above the bench (mm): e.g. 8.5 when plugged into a breadboard. */
  z?: number;
  params: Record<string, unknown>;
}

export interface Wire {
  id: string;
  a: TermRef;
  b: TermRef;
  color: string;
}

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  /** Stable code, e.g. "missing-ground"; used by tests and to group messages. */
  code: string;
  severity: Severity;
  title: string;
  detail: string;
  fix?: string;
  parts?: string[];
  wires?: string[];
  pins?: string[];
}

export interface SerialLine {
  t: number;
  text: string;
  kind: 'out' | 'boot' | 'sys' | 'err';
}
