import { button, led, resistor } from './basic';
import { dht11, dht22, ssd1306 } from './modules';
import { battery, bme280, buzzerActive, buzzerPassive, dcMotor, l298n, servo, st7735 } from './actuators';
import { ldr, pir, potentiometer, rgbLed } from './inputs';
import { breadboard } from './breadboard';
import type { ComponentDef } from './types';

const all: ComponentDef[] = [
  led, rgbLed, resistor, button, potentiometer, ldr, pir, dht22, dht11, bme280, ssd1306, st7735,
  buzzerActive, buzzerPassive, servo, dcMotor, l298n, battery, breadboard,
];

export const REGISTRY: Record<string, ComponentDef> = Object.fromEntries(all.map((d) => [d.type, d]));

export function registerComponent(def: ComponentDef) {
  REGISTRY[def.type] = def;
}

export const getDef = (type: string): ComponentDef => {
  const d = REGISTRY[type];
  if (!d) throw new Error(`Unknown component type "${type}"`);
  return d;
};

/** Only parts whose behaviour is implemented are offered in the catalogue. */
export const catalogue = () => Object.values(REGISTRY).filter((d) => d.status === 'ready');
