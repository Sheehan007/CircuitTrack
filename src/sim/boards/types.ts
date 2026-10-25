import type { V3 } from '../types';

export type PinKind = 'gpio' | 'power' | 'ground' | 'control';

export type PinRole =
  | 'strapping'
  | 'input-only'
  | 'uart0'
  | 'jtag'
  | 'onboard-led'
  | 'boot-pwm'
  | 'flash-voltage';

export interface PinCaps {
  digitalIn: boolean;
  digitalOut: boolean;
  pullUp: boolean;
  pullDown: boolean;
  pwm: boolean;
  adc?: { unit: 1 | 2; channel: number };
  touch?: number;
  dac?: 1 | 2;
  rtc: boolean;
}

export interface PinDef {
  /** Terminal id used in wires: "GPIO23", "3V3", "VIN", "GND_L", "GND_R", "EN". */
  id: string;
  /** Silkscreen label printed next to the pin. */
  label: string;
  kind: PinKind;
  gpio?: number;
  side: 'left' | 'right';
  /** 0 = nearest the antenna. */
  index: number;
  /** Pin tip in board-local mm. */
  pos: V3;
  caps: PinCaps;
  roles: PinRole[];
  /** Default peripheral functions in Arduino-ESP32 core 3.x. */
  defaults: string[];
  notes: string[];
  /** Supply voltage for power pins. */
  volts?: number;
}

export interface BoardProfile {
  id: string;
  name: string;
  chip: string;
  module: string;
  usbBridge: string;
  /** PCB outline in board-local mm: x along the length (antenna at -x, USB at +x), y across. */
  size: { length: number; width: number; thickness: number };
  pcbZ: number;
  pinTipZ: number;
  logicVolts: number;
  absMaxPinVolts: number;
  gpioRecommendedMa: number;
  gpioAbsMaxMa: number;
  /** Approximate internal pull resistor value. */
  pullOhms: number;
  /** Output driver resistance used by the simplified solver. */
  outputOhms: number;
  /** Budget for everything powered from the 3V3 pin. */
  regulatorMaxMa: number;
  onboardLed: { gpio: number; color: string; seriesOhms: number; vf: number };
  i2cDefault: { sda: number; scl: number };
  spiDefault: { mosi: number; miso: number; sck: number; ss: number };
  pins: PinDef[];
  specs: [string, string][];
  sources: string[];
}
