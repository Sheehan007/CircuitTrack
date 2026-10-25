import type { Program } from './program/types';
import { emptyProgram } from './program/types';
import type { PartInstance, Wire } from './types';
import { getDef } from './components/registry';

export const PROJECT_VERSION = 1;
export const BOARD_PART_ID = 'esp32';

export interface Project {
  version: number;
  id: string;
  name: string;
  description: string;
  board: 'doit-devkit-v1';
  /** The board itself is placed like a part (id "esp32"). */
  boardPlacement: { x: number; y: number; rot: number };
  parts: PartInstance[];
  wires: Wire[];
  program: Program;
  /**
   * What runs on the board: 'code' = the Arduino sketch in `firmware` (compiled and executed), 'rules' = the visual
   * behaviour program. Projects saved before code execution existed have no runMode and stay in 'rules'.
   */
  runMode?: 'code' | 'rules';
  firmware?: { source: string };
  /** Template or lesson this project started from, if any. */
  origin?: string;
  createdAt: number;
  updatedAt: number;
}

/** The sketch a new project starts with. */
export const STARTER_SKETCH = `// ESP32 Lab runs a subset of Arduino C++: the Reference tab (right) lists what is supported.

void setup() {
  Serial.begin(115200);
  Serial.println("Hello from the ESP32!");
}

void loop() {
  // put your main code here, to run repeatedly
  delay(1000);
}
`;

let counter = 0;
export const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

export const blankProject = (name = 'Untitled project'): Project => ({
  version: PROJECT_VERSION,
  id: uid('p'),
  name,
  description: '',
  board: 'doit-devkit-v1',
  boardPlacement: { x: 0, y: 0, rot: 0 },
  parts: [],
  wires: [],
  program: emptyProgram(),
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

/** A new Build project: an Arduino sketch runs on the board. */
export const blankSketchProject = (name = 'Untitled project', source = STARTER_SKETCH): Project => ({
  ...blankProject(name),
  runMode: 'code',
  firmware: { source },
});

/** Next free label like "LED 3" for a new part. */
export function nextLabel(project: Project, type: string) {
  const prefix = getDef(type).labelPrefix;
  let n = 1;
  const used = new Set(project.parts.map((p) => p.label));
  while (used.has(`${prefix} ${n}`)) n++;
  return `${prefix} ${n}`;
}

export function nextPartId(project: Project, type: string) {
  let n = 1;
  const used = new Set(project.parts.map((p) => p.id));
  while (used.has(`${type}${n}`)) n++;
  return `${type}${n}`;
}

/** Structural validation for imported files: throws a readable message on anything malformed. */
export function validateProject(raw: unknown): Project {
  const p = raw as Partial<Project>;
  const fail = (msg: string) => { throw new Error(`Not a valid ESP32 Lab project: ${msg}`); };
  if (!p || typeof p !== 'object') fail('the file is not a JSON object');
  if (p.version !== PROJECT_VERSION) fail(`unsupported version ${String(p.version)}`);
  if (p.board !== 'doit-devkit-v1') fail(`unknown board "${String(p.board)}"`);
  if (!Array.isArray(p.parts) || !Array.isArray(p.wires)) fail('parts and wires must be lists');
  for (const part of p.parts!) {
    if (typeof part.id !== 'string' || typeof part.type !== 'string') fail('a part is missing its id or type');
    try { getDef(part.type); } catch { fail(`unknown part type "${part.type}"`); }
  }
  const ids = new Set([BOARD_PART_ID, ...p.parts!.map((x) => x.id)]);
  for (const w of p.wires!) {
    if (!w?.a || !w?.b || !ids.has(w.a.part) || !ids.has(w.b.part)) fail(`wire ${String(w?.id)} points at a missing part`);
  }
  if (!p.program || typeof p.program !== 'object') fail('the behaviour program is missing');
  if (p.runMode != null && p.runMode !== 'code' && p.runMode !== 'rules') fail(`unknown run mode "${String(p.runMode)}"`);
  if (p.firmware != null && typeof p.firmware.source !== 'string') fail('the sketch source must be text');
  if (p.runMode === 'code' && !p.firmware) fail('a code project needs its sketch');
  return {
    ...(p as Project),
    name: String(p.name ?? 'Imported project'),
    description: String(p.description ?? ''),
    boardPlacement: p.boardPlacement ?? { x: 0, y: 0, rot: 0 },
    program: { ...emptyProgram(), ...p.program },
  };
}

export const cloneProject = (p: Project): Project => JSON.parse(JSON.stringify(p));
