import { drawButton, drawLed, drawResistor } from './parts/basic';
import { drawDht, drawOled } from './parts/modules';
import { drawBattery, drawBreadboard, drawBme280, drawBuzzerActive, drawBuzzerPassive, drawL298n, drawLdr, drawMotor, drawPir, drawPot, drawRgb, drawServo, drawTft } from './parts/more';
import type { PartDrawer } from './parts/types';

/** Visual layer registry: one drawer per component type. A type without a drawer is never offered in the UI. */
export const DRAWERS: Record<string, PartDrawer> = {
  led: drawLed,
  resistor: drawResistor,
  button: drawButton,
  dht22: drawDht('DHT22'),
  dht11: drawDht('DHT11'),
  ssd1306: drawOled,
  bme280: drawBme280,
  st7735: drawTft,
  servo: drawServo,
  dcmotor: drawMotor,
  l298n: drawL298n,
  battery: drawBattery,
  'buzzer-active': drawBuzzerActive,
  'buzzer-passive': drawBuzzerPassive,
  pot: drawPot,
  ldr: drawLdr,
  pir: drawPir,
  rgb: drawRgb,
  breadboard: drawBreadboard,
};

export function registerDrawer(type: string, d: PartDrawer) {
  DRAWERS[type] = d;
}
