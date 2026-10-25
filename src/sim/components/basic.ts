import type { ComponentDef } from './types';

/* LED forward voltages at ~10 mA for common 5 mm through-hole parts (typical datasheet values). */
export const LED_COLORS: Record<string, { vf: number; hex: string; label: string }> = {
  red: { vf: 2.0, hex: '#ef3b2d', label: 'Red' },
  orange: { vf: 2.0, hex: '#ff8a1f', label: 'Orange' },
  yellow: { vf: 2.1, hex: '#ffd21f', label: 'Yellow' },
  green: { vf: 2.2, hex: '#35c759', label: 'Green' },
  blue: { vf: 3.0, hex: '#2f7bff', label: 'Blue' },
  white: { vf: 3.0, hex: '#f4f7ff', label: 'White' },
};

export const RESISTOR_VALUES = [100, 150, 220, 330, 470, 680, 1000, 2200, 4700, 10000, 47000, 100000];

export const formatOhms = (r: number) =>
  r >= 1e6 ? `${+(r / 1e6).toFixed(2)} MΩ` : r >= 1000 ? `${+(r / 1000).toFixed(2)} kΩ` : `${r} Ω`;

export const led: ComponentDef = {
  type: 'led',
  name: 'LED (5 mm)',
  category: 'Outputs',
  summary: 'Lights up when current flows from the long leg (anode) to the short leg (cathode). Needs a series resistor.',
  status: 'ready',
  insertable: true,
  labelPrefix: 'LED',
  bounds: [[-3, -3, 0], [3, 3, 14]],
  terminals: [
    { id: 'A', label: 'Anode (+)', pos: [0, -1.27, 0.4], kind: 'passive', description: 'Long leg. Connect toward the GPIO / supply through a resistor.' },
    { id: 'K', label: 'Cathode (−)', pos: [0, 1.27, 0.4], kind: 'passive', description: 'Short leg, flat side of the rim. Connect toward GND.' },
  ],
  params: [
    { key: 'color', label: 'Colour', kind: 'select', group: 'config', options: Object.entries(LED_COLORS).map(([value, c]) => ({ value, label: `${c.label} (Vf ≈ ${c.vf} V)` })), help: 'Blue and white LEDs need about 3 V, so they are dim on a 3.3 V pin.' },
  ],
  defaults: { color: 'red' },
  electrical: (c) => {
    const col = LED_COLORS[c.params.color as string] ?? LED_COLORS.red;
    return [{ kind: 'D', id: c.id('d'), a: c.node('A'), b: c.node('K'), vf: col.vf, rs: 12 }];
  },
  specs: (p) => {
    const col = LED_COLORS[p.color as string] ?? LED_COLORS.red;
    return [['Forward voltage', `${col.vf} V`], ['Typical current', '10–20 mA'], ['Absolute max', '~30 mA']];
  },
  alt: (p) => `${(LED_COLORS[p.color as string] ?? LED_COLORS.red).label} 5 mm LED with a long anode leg and a short cathode leg.`,
};

export const resistor: ComponentDef = {
  type: 'resistor',
  name: 'Resistor',
  category: 'Passives',
  summary: 'Limits current. 220 Ω–1 kΩ is typical in series with an LED on a 3.3 V pin.',
  status: 'ready',
  insertable: true,
  labelPrefix: 'R',
  bounds: [[-5.6, -1.6, 0], [5.6, 1.6, 4.4]],
  terminals: [
    { id: '1', label: 'Lead 1', pos: [-5.08, 0, 0.4], kind: 'passive', description: 'Resistors have no polarity.' },
    { id: '2', label: 'Lead 2', pos: [5.08, 0, 0.4], kind: 'passive', description: 'Resistors have no polarity.' },
  ],
  params: [
    { key: 'ohms', label: 'Resistance', kind: 'select', group: 'config', options: RESISTOR_VALUES.map((v) => ({ value: v, label: formatOhms(v) })), help: 'The colour bands on the drawing follow the value.' },
  ],
  defaults: { ohms: 220 },
  electrical: (c) => [{ kind: 'R', id: c.id('r'), a: c.node('1'), b: c.node('2'), ohms: Number(c.params.ohms) || 220 }],
  specs: (p) => [['Resistance', formatOhms(Number(p.ohms))], ['Power rating', '1/4 W'], ['Tolerance', '5 % (gold band)']],
  alt: (p) => `${formatOhms(Number(p.ohms))} through-hole resistor with colour bands.`,
};

export const button: ComponentDef = {
  type: 'button',
  name: 'Push button (6 mm tactile)',
  category: 'Inputs',
  summary: 'Four legs in two pairs. Each pair is always connected; pressing joins the pairs.',
  status: 'ready',
  insertable: true,
  labelPrefix: 'Button',
  bounds: [[-4.4, -3.6, 0], [4.4, 3.6, 8]],
  terminals: [
    { id: '1a', label: 'Leg 1a', pos: [-3.81, -2.54, 0.4], kind: 'passive', description: 'Joined to leg 1b inside the switch.' },
    { id: '1b', label: 'Leg 1b', pos: [3.81, -2.54, 0.4], kind: 'passive', description: 'Joined to leg 1a inside the switch.' },
    { id: '2a', label: 'Leg 2a', pos: [-3.81, 2.54, 0.4], kind: 'passive', description: 'Joined to leg 2b inside the switch.' },
    { id: '2b', label: 'Leg 2b', pos: [3.81, 2.54, 0.4], kind: 'passive', description: 'Joined to leg 2a inside the switch.' },
  ],
  internalShorts: [['1a', '1b'], ['2a', '2b']],
  params: [
    { key: 'cap', label: 'Cap colour', kind: 'select', group: 'config', options: [{ value: 'red', label: 'Red' }, { value: 'black', label: 'Black' }, { value: 'blue', label: 'Blue' }, { value: 'yellow', label: 'Yellow' }] },
  ],
  defaults: { cap: 'red' },
  interactions: [{ key: 'pressed', label: 'Press', kind: 'momentary', help: 'Hold it down with the pointer, or use the inspector / Space key.' }],
  electrical: (c) => [{ kind: 'SW', id: c.id('sw'), a: c.node('1a'), b: c.node('2a'), closed: !!c.inputs.pressed }],
  specs: () => [['Type', '6 × 6 mm tactile, momentary'], ['Contacts', 'Normally open'], ['Bounce', 'a few ms (not simulated)']],
  alt: (p) => `Square tactile push button with a ${p.cap} round cap and four legs.`,
};
