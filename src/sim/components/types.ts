import type { Element } from '../solver';
import type { V3 } from '../types';

export type Category = 'Outputs' | 'Inputs' | 'Passives' | 'Sensors' | 'Displays' | 'Actuators' | 'Prototyping';

export interface TerminalDef {
  id: string;
  label: string;
  /** Terminal tip in part-local mm (before the part's rotation). */
  pos: V3;
  kind: 'power' | 'ground' | 'signal' | 'passive';
  description: string;
}

export interface ParamOption {
  value: string | number;
  label: string;
}

export interface ParamDef {
  key: string;
  label: string;
  kind: 'number' | 'select' | 'boolean' | 'text';
  /** config = how the part is built; environment = the world around it (temperature, light...). */
  group: 'config' | 'environment';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: ParamOption[];
  help?: string;
}

export interface PowerSpec {
  vcc: string;
  gnd: string;
  minV: number;
  maxV: number;
  /** Typical supply current, used as a load on the supply. */
  typicalMa: number;
}

export interface Interaction {
  key: string;
  label: string;
  kind: 'momentary' | 'toggle';
  help: string;
}

export interface ElectricalCtx {
  /** Solver node for a terminal of this part. */
  node(term: string): number;
  /** A fresh internal node (e.g. between a module's pull-up and its supply). */
  internal(name: string): number;
  params: Record<string, any>;
  inputs: Record<string, any>;
  /** Prefix element ids with the part id so currents can be looked up later. */
  id(name: string): string;
  /**
   * Supply voltage (VCC − GND) found by the first solver pass, or null during that pass. Modules with an on-board
   * regulator use it to switch their regulated rail on.
   */
  supply: number | null;
  /** Node voltage at a terminal from the first solver pass (null during it): lets a module react to its inputs. */
  volts(term: string): number | null;
  /** The part's runtime device state (e.g. whether a servo is moving), read-only here. */
  state: Record<string, any> | undefined;
}

export interface ComponentDef {
  type: string;
  name: string;
  category: Category;
  summary: string;
  /** "ready" parts appear in the catalogue; "planned" parts are hidden until they really work. */
  status: 'ready' | 'planned';
  /** Local bounding box (mm), used for selection and draw order. */
  bounds: [V3, V3];
  terminals: TerminalDef[];
  /** Leaded part whose legs plug into a breadboard (terminals at the bottom of its legs). */
  insertable?: boolean;
  /** Pairs of terminals that are always connected inside the part (e.g. a tactile switch's leg pairs). */
  internalShorts?: [string, string][];
  params: ParamDef[];
  defaults: Record<string, unknown>;
  power?: PowerSpec;
  interactions?: Interaction[];
  /** Logical device the program can talk to. */
  device?: 'dht' | 'ssd1306' | 'bme280' | 'tft' | 'servo' | 'motor' | 'driver' | 'buzzer-active' | 'buzzer-passive' | 'pot' | 'ldr' | 'pir' | 'rgb';
  electrical(ctx: ElectricalCtx): Element[];
  specs(params: Record<string, any>): [string, string][];
  /** Text alternative for the illustrated part. */
  alt(params: Record<string, any>): string;
  labelPrefix: string;
}
