/*
  Guided lessons. A lesson is a project built from a few parameters, read-only Arduino-ESP32 (core 3.x) code built
  from the same parameters, and steps whose checks read the live simulation. Because the project, the code and the
  behaviour all come from one set of values, they cannot drift apart.
*/
import type { Snapshot } from '../sim/engine';
import { blankProject, type Project } from '../sim/project';
import type { HistoryPoint } from '../sim/engine';
import { act, rule, WIRE_COLORS } from './templates';
import { formatOhms, LED_COLORS, RESISTOR_VALUES } from '../sim/components/basic';

export interface LessonParam {
  key: string;
  label: string;
  options: { value: string | number; label: string }[];
  help: string;
}

export interface CheckCtx {
  snap: Snapshot;
  values: Record<string, any>;
  history: Map<number, HistoryPoint[]>;
  /** Values when the step was opened (to detect "changed it"). */
  startValues: Record<string, any>;
}

export interface LessonStep {
  title: string;
  body: string;
  /** Returns true once the learner has done the step. Steps without a check are read-and-continue. */
  check?: (c: CheckCtx) => boolean;
  hint?: string;
}

export interface Lesson {
  id: string;
  number: number;
  title: string;
  summary: string;
  minutes: number;
  params: LessonParam[];
  defaults: Record<string, any>;
  build(values: Record<string, any>): Project;
  code(values: Record<string, any>): string;
  /** Code line (1-based) for the action that just ran. */
  highlight(active: Snapshot['active'], snap: Snapshot, values: Record<string, any>): number | null;
  overview: string[];
  pins: string[];
  parts: string[];
  steps: LessonStep[];
}

/** Level changes seen on a pin since reset (outputs start LOW). */
const toggles = (h: Map<number, HistoryPoint[]>, gpio: number) =>
  (h.get(gpio) ?? []).filter((p, i, a) => p.v !== (i ? a[i - 1].v : 0)).length;

/* ------------------------------------------------------------------ Blink */

const blinkCode = (v: Record<string, any>) => `// Blink an external LED on GPIO23 (Arduino-ESP32 core 3.x)
const int LED_PIN = 23;

void setup() {
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);   // 3.3 V: current flows, LED on
  delay(${v.delay});
  digitalWrite(LED_PIN, LOW);    // 0 V: no current, LED off
  delay(${v.delay});
}
`;

function blinkProject(v: Record<string, any>): Project {
  const p = blankProject('Lesson: Blink an LED');
  p.origin = 'lesson:blink';
  p.parts = [
    { id: 'r1', type: 'resistor', label: 'R 1', x: -20, y: -32, rot: 0, params: { ohms: v.ohms } },
    { id: 'led1', type: 'led', label: 'LED 1', x: -8, y: -37, rot: 0, params: { color: v.color } },
  ];
  p.wires = [
    { id: 'w1', a: { part: 'esp32', term: 'GPIO23' }, b: { part: 'r1', term: '1' }, color: WIRE_COLORS.data },
    { id: 'w2', a: { part: 'r1', term: '2' }, b: { part: 'led1', term: 'A' }, color: WIRE_COLORS.other },
    { id: 'w3', a: { part: 'led1', term: 'K' }, b: { part: 'esp32', term: 'GND_R' }, color: WIRE_COLORS.ground },
  ];
  p.program = {
    pins: { 23: 'OUTPUT' }, i2c: { sda: 21, scl: 22 }, devices: [], vars: [],
    rules: [
      rule({ id: 'blink', name: `Every ${v.delay} ms: flip GPIO23`, trigger: { kind: 'every', ms: Number(v.delay), immediate: true }, actions: [act({ kind: 'digitalWrite', pin: 23, value: 'TOGGLE' }, 'toggle')] }),
    ],
  };
  return p;
}

export const blinkLesson: Lesson = {
  id: 'blink',
  number: 1,
  title: 'Blink an LED',
  summary: 'Your first output: switch GPIO23 on and off to blink an LED through a resistor.',
  minutes: 5,
  params: [
    { key: 'delay', label: 'delay()', options: [100, 250, 500, 1000].map((d) => ({ value: d, label: `${d} ms` })), help: 'How long each half of the blink lasts.' },
    { key: 'ohms', label: 'Resistor', options: RESISTOR_VALUES.filter((r) => r >= 100 && r <= 10000).map((r) => ({ value: r, label: formatOhms(r) })), help: 'Bigger resistance → less current → dimmer LED.' },
    { key: 'color', label: 'LED colour', options: Object.entries(LED_COLORS).map(([k, c]) => ({ value: k, label: c.label })), help: 'Blue and white LEDs need ~3 V, so they are dim on 3.3 V.' },
  ],
  defaults: { delay: 500, ohms: 220, color: 'red' },
  build: blinkProject,
  code: blinkCode,
  highlight: (active, snap) => {
    if (!active || active.actionId !== 'toggle') return null;
    return snap.pins.GPIO23?.level ? 9 : 11;
  },
  overview: [
    'GPIO23 is set to OUTPUT, so the program can make it 3.3 V (HIGH) or 0 V (LOW).',
    'Current flows GPIO23 → resistor → LED (long leg first) → GND. The resistor limits it to a safe ~6 mA.',
    'loop() repeats forever: on, wait, off, wait.',
  ],
  pins: ['GPIO23', 'GND_R'],
  parts: ['220 Ω resistor', 'Red 5 mm LED'],
  steps: [
    { title: 'Meet the circuit', body: 'GPIO23 feeds a 220 Ω resistor, the resistor feeds the LED\'s long leg (anode), and the short leg (cathode) goes back to GND. Hover a wire or click a part to see what it does.' },
    { title: 'Run the sketch', body: 'Press **Run** (or the Space key). The board boots, prints its boot log on the serial monitor, and the behaviour starts.', check: (c) => c.snap.firmware === 'running', hint: 'The Run button is at the top of the screen.' },
    { title: 'Watch it blink', body: 'The LED should blink, and the signal view shows GPIO23 going HIGH and LOW. The highlighted code line follows along.', check: (c) => toggles(c.history, 23) >= 6, hint: 'Let it run for a few seconds. Speed up the clock with the speed control if you like.' },
    { title: 'Change the timing', body: 'Pick a shorter **delay()** above the code. The code, the behaviour and the blinking all change together.', check: (c) => Number(c.values.delay) !== Number(c.startValues.delay), hint: 'Use the delay() chooser in the code panel.' },
    { title: 'Try another resistor', body: 'Choose **1 kΩ** or **10 kΩ**. Less current flows, so the LED gets dimmer; the inspector shows the current in mA.', check: (c) => Number(c.values.ohms) > 220, hint: 'Use the Resistor chooser, or click the resistor on the board.' },
    { title: 'Open it in Build', body: 'Everything here is a normal project. Press **Open in Build** to rewire it, add parts and save your own version.' },
  ],
};

/* ------------------------------------------------------------------ Button */

const buttonCode = (v: Record<string, any>) => v.mode === 'toggle'
  ? `// Toggle an LED with a push button (Arduino-ESP32 core 3.x)
const int BUTTON_PIN = 4;    // button between GPIO4 and GND
const int LED_PIN = 23;

bool ledOn = false;
int lastState = HIGH;

void setup() {
  pinMode(BUTTON_PIN, INPUT_PULLUP);  // released = HIGH, pressed = LOW
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  int state = digitalRead(BUTTON_PIN);
  if (lastState == HIGH && state == LOW) {  // just pressed
    ledOn = !ledOn;
    digitalWrite(LED_PIN, ledOn ? HIGH : LOW);
  }
  lastState = state;
  delay(10);  // crude debounce
}
`
  : `// Light an LED while a button is held (Arduino-ESP32 core 3.x)
const int BUTTON_PIN = 4;    // button between GPIO4 and GND
const int LED_PIN = 23;

void setup() {
  pinMode(BUTTON_PIN, INPUT_PULLUP);  // released = HIGH, pressed = LOW
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  if (digitalRead(BUTTON_PIN) == LOW) {
    digitalWrite(LED_PIN, HIGH);  // pressed
  } else {
    digitalWrite(LED_PIN, LOW);   // released
  }
}
`;

function buttonProject(v: Record<string, any>): Project {
  const p = blankProject('Lesson: Push a button');
  p.origin = 'lesson:button';
  p.parts = [
    { id: 'btn1', type: 'button', label: 'Button 1', x: 3, y: -36, rot: 0, params: { cap: 'red' } },
    { id: 'r1', type: 'resistor', label: 'R 1', x: -20, y: -32, rot: 0, params: { ohms: 220 } },
    { id: 'led1', type: 'led', label: 'LED 1', x: -8, y: -37, rot: 0, params: { color: 'green' } },
  ];
  p.wires = [
    { id: 'w1', a: { part: 'btn1', term: '1a' }, b: { part: 'esp32', term: 'GPIO4' }, color: WIRE_COLORS.signal },
    { id: 'w2', a: { part: 'btn1', term: '2b' }, b: { part: 'esp32', term: 'GND_R' }, color: WIRE_COLORS.ground },
    { id: 'w3', a: { part: 'esp32', term: 'GPIO23' }, b: { part: 'r1', term: '1' }, color: WIRE_COLORS.data },
    { id: 'w4', a: { part: 'r1', term: '2' }, b: { part: 'led1', term: 'A' }, color: WIRE_COLORS.other },
    { id: 'w5', a: { part: 'led1', term: 'K' }, b: { part: 'esp32', term: 'GND_R' }, color: WIRE_COLORS.ground },
  ];
  const isToggle = v.mode === 'toggle';
  p.program = {
    pins: { 4: 'INPUT_PULLUP', 23: 'OUTPUT' }, i2c: { sda: 21, scl: 22 }, devices: [], vars: [],
    rules: isToggle
      ? [rule({ id: 'press', name: 'Button pressed → flip the LED', trigger: { kind: 'pinEdge', pin: 4, edge: 'falling' }, actions: [act({ kind: 'digitalWrite', pin: 23, value: 'TOGGLE' }, 'toggle')] })]
      : [rule({
        id: 'follow', name: 'Button changes → LED follows', trigger: { kind: 'pinEdge', pin: 4, edge: 'change' },
        conditions: [{ left: { kind: 'digitalRead', pin: 4 }, op: '==', right: { kind: 'num', value: 0 } }],
        actions: [act({ kind: 'digitalWrite', pin: 23, value: 'HIGH' }, 'on')],
        elseActions: [act({ kind: 'digitalWrite', pin: 23, value: 'LOW' }, 'off')],
      })],
  };
  return p;
}

export const buttonLesson: Lesson = {
  id: 'button',
  number: 2,
  title: 'Push a button',
  summary: 'Read an input: a button pulls GPIO4 to GND, and the internal pull-up holds it HIGH otherwise.',
  minutes: 6,
  params: [
    { key: 'mode', label: 'Logic', options: [{ value: 'hold', label: 'Hold (LED on while pressed)' }, { value: 'toggle', label: 'Toggle (each press flips it)' }], help: 'Two common ways to use a button.' },
  ],
  defaults: { mode: 'hold' },
  build: buttonProject,
  code: buttonCode,
  highlight: (active, _snap, v) => {
    if (!active?.actionId) return null;
    if (v.mode === 'toggle') return active.actionId === 'toggle' ? 17 : null;
    return active.actionId === 'on' ? 12 : active.actionId === 'off' ? 14 : null;
  },
  overview: [
    'INPUT_PULLUP connects GPIO4 to 3.3 V through a ~45 kΩ resistor inside the ESP32, so the pin reads HIGH when nothing else drives it.',
    'Pressing the button connects GPIO4 straight to GND, which wins over the weak pull-up: the pin reads LOW.',
    'So on this wiring LOW means pressed. No external resistor is needed.',
  ],
  pins: ['GPIO4', 'GPIO23', 'GND_R'],
  parts: ['6 mm push button', '220 Ω resistor', 'Green 5 mm LED'],
  steps: [
    { title: 'Look at the wiring', body: 'One button leg goes to GPIO4, the leg diagonally opposite goes to GND. The legs on each side are joined inside the switch, so wiring two legs of the same side would short it permanently.' },
    { title: 'Run the sketch', body: 'Press **Run**. Open the **GPIO** tab: GPIO4 reads HIGH (about 3.3 V) because of the internal pull-up.', check: (c) => c.snap.firmware === 'running' },
    { title: 'Press and hold', body: 'Hold the button down with the pointer (or select it and hold **Space**). GPIO4 drops to 0 V and the LED lights.', check: (c) => !!c.snap.parts.btn1?.visual.pressed && (c.snap.parts.led1?.visual.brightness as number) > 0.2, hint: 'Press on the red cap of the button and keep the mouse button down.' },
    { title: 'Switch to toggle', body: 'Change **Logic** to *Toggle*. Now each press flips the LED, the way a lamp switch works.', check: (c) => c.values.mode === 'toggle' },
    { title: 'Toggle it twice', body: 'Press and release twice. The LED stays on after the first press and goes off after the second.', check: (c) => c.values.mode === 'toggle' && toggles(c.history, 23) >= 2, hint: 'Each full press (down then up) counts once.' },
  ],
};

export const LESSONS: Lesson[] = [blinkLesson, buttonLesson];
