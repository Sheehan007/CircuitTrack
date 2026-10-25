import type { BoardProfile, PinCaps, PinDef, PinRole } from './types';

/*
  DOIT ESP32 DevKit V1, 30-pin version (ESP-WROOM-32, CP2102 USB bridge).
  Header order verified against the published Mischianti DOIT pinout and espboards.dev's pin table (Oct 2026);
  capabilities follow the ESP32 datasheet / ESP-IDF GPIO reference:
    - GPIO34–39 are input-only and have no internal pull-up/pull-down.
    - Strapping pins: GPIO0, 2, 5, 12, 15.  GPIO12 high at reset selects 1.8 V flash and stops boot on this module.
    - ADC2 cannot be used while Wi-Fi is on.  GPIO6–11 (flash) are not broken out on this board.
    - TX0/RX0 (GPIO1/3) go to the CP2102 for uploading and Serial.
    - GPIO2 drives the on-board blue LED.
  Board size 51.45 x 28.33 mm (espboards.dev). Header row spacing is drawn at 0.9" (22.86 mm).
*/

const PITCH = 2.54;
const ROW_Y = 22.86 / 2;
const FIRST_X = -21.6;
const PCB_Z = 2.4; // the PCB rests on its solder joints
const PCB_T = 1.6;
const TIP_Z = PCB_Z + PCB_T + 2.5 + 6.0; // header body 2.5 mm + 6 mm of pin

const gp = (over: Partial<PinCaps> = {}): PinCaps => ({
  digitalIn: true, digitalOut: true, pullUp: true, pullDown: true, pwm: true, rtc: false, ...over,
});
const none: PinCaps = { digitalIn: false, digitalOut: false, pullUp: false, pullDown: false, pwm: false, rtc: false };

interface Row {
  id: string;
  label: string;
  kind: PinDef['kind'];
  gpio?: number;
  caps: PinCaps;
  roles?: PinRole[];
  defaults?: string[];
  notes?: string[];
  volts?: number;
}

const LEFT: Row[] = [
  { id: 'EN', label: 'EN', kind: 'control', caps: none, notes: ['Chip enable. Pulled up on the board; pulling it LOW holds the ESP32 in reset (same as pressing EN).'] },
  { id: 'GPIO36', label: 'VP', kind: 'gpio', gpio: 36, caps: gp({ digitalOut: false, pullUp: false, pullDown: false, pwm: false, adc: { unit: 1, channel: 0 }, rtc: true }), roles: ['input-only'], notes: ['Input only, no internal pull resistors. ADC1 channel 0 (works with Wi-Fi on).'] },
  { id: 'GPIO39', label: 'VN', kind: 'gpio', gpio: 39, caps: gp({ digitalOut: false, pullUp: false, pullDown: false, pwm: false, adc: { unit: 1, channel: 3 }, rtc: true }), roles: ['input-only'], notes: ['Input only, no internal pull resistors. ADC1 channel 3.'] },
  { id: 'GPIO34', label: 'D34', kind: 'gpio', gpio: 34, caps: gp({ digitalOut: false, pullUp: false, pullDown: false, pwm: false, adc: { unit: 1, channel: 6 }, rtc: true }), roles: ['input-only'], notes: ['Input only, no internal pull resistors. ADC1 channel 6.'] },
  { id: 'GPIO35', label: 'D35', kind: 'gpio', gpio: 35, caps: gp({ digitalOut: false, pullUp: false, pullDown: false, pwm: false, adc: { unit: 1, channel: 7 }, rtc: true }), roles: ['input-only'], notes: ['Input only, no internal pull resistors. ADC1 channel 7.'] },
  { id: 'GPIO32', label: 'D32', kind: 'gpio', gpio: 32, caps: gp({ adc: { unit: 1, channel: 4 }, touch: 9, rtc: true }), notes: ['General purpose. ADC1 channel 4, touch T9.'] },
  { id: 'GPIO33', label: 'D33', kind: 'gpio', gpio: 33, caps: gp({ adc: { unit: 1, channel: 5 }, touch: 8, rtc: true }), notes: ['General purpose. ADC1 channel 5, touch T8.'] },
  { id: 'GPIO25', label: 'D25', kind: 'gpio', gpio: 25, caps: gp({ adc: { unit: 2, channel: 8 }, dac: 1, rtc: true }), notes: ['DAC1 (true analog output). ADC2 channel 8: not usable for analogRead while Wi-Fi is on.'] },
  { id: 'GPIO26', label: 'D26', kind: 'gpio', gpio: 26, caps: gp({ adc: { unit: 2, channel: 9 }, dac: 2, rtc: true }), notes: ['DAC2 (true analog output). ADC2 channel 9.'] },
  { id: 'GPIO27', label: 'D27', kind: 'gpio', gpio: 27, caps: gp({ adc: { unit: 2, channel: 7 }, touch: 7, rtc: true }), notes: ['General purpose. ADC2 channel 7, touch T7.'] },
  { id: 'GPIO14', label: 'D14', kind: 'gpio', gpio: 14, caps: gp({ adc: { unit: 2, channel: 6 }, touch: 6, rtc: true }), roles: ['jtag', 'boot-pwm'], defaults: ['HSPI SCK'], notes: ['JTAG TMS. Outputs a short PWM signal at boot. HSPI clock.'] },
  { id: 'GPIO12', label: 'D12', kind: 'gpio', gpio: 12, caps: gp({ adc: { unit: 2, channel: 5 }, touch: 5, rtc: true }), roles: ['strapping', 'jtag', 'flash-voltage'], defaults: ['HSPI MISO'], notes: ['Strapping pin (MTDI): if it is HIGH at reset the module selects 1.8 V flash and will not boot. Avoid pull-ups here.'] },
  { id: 'GPIO13', label: 'D13', kind: 'gpio', gpio: 13, caps: gp({ adc: { unit: 2, channel: 4 }, touch: 4, rtc: true }), roles: ['jtag'], defaults: ['HSPI MOSI'], notes: ['JTAG TCK. ADC2 channel 4, touch T4.'] },
  { id: 'GND_L', label: 'GND', kind: 'ground', caps: none, notes: ['Ground. Every circuit needs a return path here.'] },
  { id: 'VIN', label: 'VIN', kind: 'power', caps: none, volts: 5, notes: ['Board input: about 5 V while powered over USB (a little less after the protection diode on real boards). Never connect it to a GPIO.'] },
];

const RIGHT: Row[] = [
  { id: 'GPIO23', label: 'D23', kind: 'gpio', gpio: 23, caps: gp(), defaults: ['VSPI MOSI'], notes: ['Safe general-purpose pin. Default SPI MOSI.'] },
  { id: 'GPIO22', label: 'D22', kind: 'gpio', gpio: 22, caps: gp(), defaults: ['I2C SCL'], notes: ['Safe general-purpose pin. Default I²C SCL (Wire).'] },
  { id: 'GPIO1', label: 'TX0', kind: 'gpio', gpio: 1, caps: gp(), roles: ['uart0'], defaults: ['UART0 TX'], notes: ['UART0 TX: wired to the CP2102 for uploading and the serial monitor. Avoid for general I/O.'] },
  { id: 'GPIO3', label: 'RX0', kind: 'gpio', gpio: 3, caps: gp(), roles: ['uart0'], defaults: ['UART0 RX'], notes: ['UART0 RX: wired to the CP2102. Avoid for general I/O.'] },
  { id: 'GPIO21', label: 'D21', kind: 'gpio', gpio: 21, caps: gp(), defaults: ['I2C SDA'], notes: ['Safe general-purpose pin. Default I²C SDA (Wire).'] },
  { id: 'GPIO19', label: 'D19', kind: 'gpio', gpio: 19, caps: gp(), defaults: ['VSPI MISO'], notes: ['Safe general-purpose pin. Default SPI MISO.'] },
  { id: 'GPIO18', label: 'D18', kind: 'gpio', gpio: 18, caps: gp(), defaults: ['VSPI SCK'], notes: ['Safe general-purpose pin. Default SPI clock.'] },
  { id: 'GPIO5', label: 'D5', kind: 'gpio', gpio: 5, caps: gp(), roles: ['strapping', 'boot-pwm'], defaults: ['VSPI SS'], notes: ['Strapping pin with an internal pull-up; outputs a PWM burst at boot. Default SPI chip-select.'] },
  { id: 'GPIO17', label: 'TX2', kind: 'gpio', gpio: 17, caps: gp(), defaults: ['UART2 TX'], notes: ['Safe general-purpose pin. UART2 TX.'] },
  { id: 'GPIO16', label: 'RX2', kind: 'gpio', gpio: 16, caps: gp(), defaults: ['UART2 RX'], notes: ['Safe general-purpose pin. UART2 RX.'] },
  { id: 'GPIO4', label: 'D4', kind: 'gpio', gpio: 4, caps: gp({ adc: { unit: 2, channel: 0 }, touch: 0, rtc: true }), notes: ['Safe general-purpose pin. ADC2 channel 0, touch T0.'] },
  { id: 'GPIO2', label: 'D2', kind: 'gpio', gpio: 2, caps: gp({ adc: { unit: 2, channel: 2 }, touch: 2, rtc: true }), roles: ['strapping', 'onboard-led'], notes: ['Drives the on-board blue LED. Strapping pin: must be LOW or floating to enter download mode.'] },
  { id: 'GPIO15', label: 'D15', kind: 'gpio', gpio: 15, caps: gp({ adc: { unit: 2, channel: 3 }, touch: 3, rtc: true }), roles: ['strapping', 'jtag', 'boot-pwm'], defaults: ['HSPI SS'], notes: ['Strapping pin (MTDO): LOW at reset silences the boot log. Outputs PWM at boot.'] },
  { id: 'GND_R', label: 'GND', kind: 'ground', caps: none, notes: ['Ground.'] },
  { id: '3V3', label: '3V3', kind: 'power', caps: none, volts: 3.3, notes: ['3.3 V from the on-board AMS1117 regulator. Powers sensors and displays; keep the total well under ~500 mA.'] },
];

const build = (rows: Row[], side: 'left' | 'right'): PinDef[] =>
  rows.map((r, i) => ({
    id: r.id,
    label: r.label,
    kind: r.kind,
    gpio: r.gpio,
    side,
    index: i,
    // the Colorfigures projection is mirror-handed (camera R × U = −V), so seen from above with the antenna up,
    // the viewer's left is +y: the EN…VIN column sits at +y and the D23…3V3 column at −y
    pos: [FIRST_X + i * PITCH, side === 'left' ? ROW_Y : -ROW_Y, TIP_Z],
    caps: r.caps,
    roles: r.roles ?? [],
    defaults: r.defaults ?? [],
    notes: r.notes ?? [],
    volts: r.volts,
  }));

export const DOIT_DEVKIT_V1: BoardProfile = {
  id: 'doit-devkit-v1',
  name: 'DOIT ESP32 DevKit V1 (30-pin)',
  chip: 'ESP32-D0WD (dual-core Xtensa LX6, 240 MHz)',
  module: 'ESP-WROOM-32',
  usbBridge: 'CP2102 (micro-USB)',
  size: { length: 51.45, width: 28.33, thickness: PCB_T },
  pcbZ: PCB_Z,
  pinTipZ: TIP_Z,
  logicVolts: 3.3,
  absMaxPinVolts: 3.6,
  gpioRecommendedMa: 20,
  gpioAbsMaxMa: 40,
  pullOhms: 45_000,
  outputOhms: 40,
  regulatorMaxMa: 500,
  onboardLed: { gpio: 2, color: 'blue', seriesOhms: 1000, vf: 2.9 },
  i2cDefault: { sda: 21, scl: 22 },
  spiDefault: { mosi: 23, miso: 19, sck: 18, ss: 5 },
  pins: [...build(LEFT, 'left'), ...build(RIGHT, 'right')],
  specs: [
    ['Microcontroller', 'ESP32-D0WD, 2 × Xtensa LX6 @ 240 MHz'],
    ['Module', 'ESP-WROOM-32, 4 MB flash'],
    ['SRAM', '520 KB'],
    ['Logic level', '3.3 V (GPIOs are not 5 V tolerant)'],
    ['Header', '30 pins, 25 GPIO broken out'],
    ['ADC', '12-bit (0–4095), 15 channels on this board'],
    ['DAC', '2 × 8-bit (GPIO25, GPIO26)'],
    ['Touch', '9 capacitive inputs on this board'],
    ['Radios', 'Wi-Fi 802.11 b/g/n, Bluetooth Classic + BLE 4.2'],
    ['USB', 'micro-USB via CP2102'],
    ['Size', '51.45 × 28.33 mm'],
  ],
  sources: [
    'https://mischianti.org/doit-esp32-dev-kit-v1-high-resolution-pinout-and-specs/',
    'https://www.espboards.dev/esp32/esp32doit-devkit-v1/',
    'https://docs.espressif.com/projects/esp-idf/en/v4.4.6/esp32/api-reference/peripherals/gpio.html',
  ],
};

export const pinById = (b: BoardProfile, id: string) => b.pins.find((p) => p.id === id);
export const pinByGpio = (b: BoardProfile, gpio: number) => b.pins.find((p) => p.gpio === gpio);
