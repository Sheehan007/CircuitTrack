/*
  Connection checks. Static checks look only at the wiring and the program; electrical checks also use the solved
  circuit. Every issue says what is wrong, why it matters on a real ESP32, and how to fix it.
*/
import type { BoardProfile } from './boards/types';
import { getDef } from './components/registry';
import type { CombinedSolution, Firmware, PartSnapshot, PinSnapshot } from './engine';
import type { Netlist } from './netlist';
import { BOARD_PART_ID, type Project } from './project';
import { termKey, type Issue } from './types';
import { stripOf } from './components/breadboard';

interface StaticCtx { project: Project; board: BoardProfile; netlist: Netlist }
interface ElecCtx extends StaticCtx { pins: Record<string, PinSnapshot>; parts: Record<string, PartSnapshot>; sol: CombinedSolution; firmware: Firmware }

const net = (c: StaticCtx, part: string, term: string) => c.netlist.netOf.get(termKey({ part, term }));
const pinNet = (c: StaticCtx, id: string) => net(c, BOARD_PART_ID, id)!;
const pinOf = (c: StaticCtx, gpio: number) => c.board.pins.find((p) => p.gpio === gpio);
const wiresAt = (c: StaticCtx, part: string, term?: string) =>
  c.project.wires.filter((w) => (w.a.part === part && (!term || w.a.term === term)) || (w.b.part === part && (!term || w.b.term === term)));
const boardPinsOn = (c: StaticCtx, n: number) => c.board.pins.filter((p) => pinNet(c, p.id) === n);
const addrOf = (p: { type: string; params: Record<string, unknown> }) => Number(p.params.address ?? getDef(p.type).defaults.address);
const describeNet = (c: StaticCtx, n: number) => {
  const pins = boardPinsOn(c, n);
  return pins.length ? pins.map((p) => (p.gpio != null ? `GPIO${p.gpio}` : p.label)).join('/') : 'nothing on the board';
};

export function staticChecks(c: StaticCtx): Issue[] {
  const out: Issue[] = [];
  const { project, board } = c;
  const prog = project.program;

  // supplies shorted together or to ground
  for (const id of ['3V3', 'VIN']) {
    if (pinNet(c, id) === 0) out.push({ code: 'short-circuit', severity: 'error', title: `${id} is wired straight to GND`, detail: `That is a short circuit across the board's ${id === '3V3' ? '3.3 V regulator' : 'USB 5 V supply'}: huge current, a hot regulator, and on a real board possibly a dead USB port.`, fix: 'Remove the wire between the supply and GND.', pins: [id, 'GND_L'] });
  }
  if (pinNet(c, '3V3') === pinNet(c, 'VIN') && pinNet(c, '3V3') !== 0) out.push({ code: 'supply-conflict', severity: 'error', title: '3V3 and VIN are wired together', detail: 'This forces 5 V back into the 3.3 V regulator output and onto everything powered from 3V3 — including the ESP32 itself.', fix: 'Remove the wire joining 3V3 and VIN.', pins: ['3V3', 'VIN'] });
  for (const p of board.pins) {
    if (p.kind !== 'gpio') continue;
    const n = pinNet(c, p.id);
    const others = boardPinsOn(c, n).filter((q) => q.id !== p.id && q.kind !== 'gpio');
    if (n === 0 || others.some((q) => q.kind === 'power')) {
      const what = n === 0 ? 'GND' : others.find((q) => q.kind === 'power')!.label;
      const mode = prog.pins[p.gpio!];
      out.push({ code: 'gpio-to-supply', severity: mode === 'OUTPUT' ? 'error' : 'warning', title: `GPIO${p.gpio} is wired directly to ${what}`, detail: mode === 'OUTPUT' ? `GPIO${p.gpio} is an OUTPUT: driving it against ${what} is a short circuit through the pin.` : `A pin wired straight to ${what} can never change, and becomes a short circuit the moment it is set to OUTPUT.${what === 'VIN' ? ' VIN is 5 V, above the ESP32\'s 3.6 V maximum.' : ''}`, fix: 'Put the component (button, sensor…) between the pin and the supply instead of a bare wire.', pins: [p.id] });
    }
  }

  // program pin set-up vs the board
  for (const [gpioStr, mode] of Object.entries(prog.pins)) {
    const gpio = Number(gpioStr);
    const p = pinOf(c, gpio);
    if (!p) { out.push({ code: 'no-such-pin', severity: 'error', title: `GPIO${gpio} isn't on this board`, detail: 'The DOIT DevKit V1 header breaks out GPIO 1–5, 12–19, 21–23, 25–27 and 32–39.', fix: 'Pick a pin that exists.' }); continue; }
    if (mode === 'OUTPUT' && !p.caps.digitalOut) out.push({ code: 'input-only-output', severity: 'error', title: `GPIO${gpio} is input-only`, detail: `GPIO34–39 have no output driver, so an OUTPUT on GPIO${gpio} (${p.label}) drives nothing.`, fix: 'Use an output-capable pin, e.g. GPIO23, 22, 19, 18, 17, 16, 4 or 25–27.', pins: [p.id] });
    if ((mode === 'INPUT_PULLUP' || mode === 'INPUT_PULLDOWN') && !p.caps.pullUp) out.push({ code: 'no-internal-pull', severity: 'warning', title: `GPIO${gpio} has no internal ${mode === 'INPUT_PULLUP' ? 'pull-up' : 'pull-down'}`, detail: 'GPIO34–39 lack internal pull resistors, so this behaves like plain INPUT and floats when nothing drives it.', fix: 'Add an external 10 kΩ resistor, or use another pin.', pins: [p.id] });
    if (p.roles.includes('uart0')) out.push({ code: 'uart0-pin', severity: 'warning', title: `GPIO${gpio} (${p.label}) is the USB serial line`, detail: 'TX0/RX0 carry uploads and Serial output through the CP2102. Using them for I/O garbles the serial monitor and can block uploading.', fix: 'Move to a free pin such as GPIO4, 16–19, 21–23 or 25–27.', pins: [p.id] });
    if (p.roles.includes('strapping') && gpio !== 2) out.push({ code: 'strapping-pin', severity: 'info', title: `GPIO${gpio} is a strapping pin`, detail: `${p.notes[0]} It works as I/O after boot, but what you connect must not hold it at the wrong level during reset.`, pins: [p.id] });
  }

  // edge triggers on pins that are not inputs
  for (const r of prog.rules) {
    if (!r.enabled || r.trigger.kind !== 'pinEdge') continue;
    const mode = prog.pins[r.trigger.pin];
    if (!mode || mode === 'OUTPUT') out.push({ code: 'edge-pin-not-input', severity: 'warning', title: `Rule "${r.name}" watches GPIO${r.trigger.pin}, which isn't set up as an input`, detail: 'An edge trigger needs the pin to be an INPUT (usually INPUT_PULLUP for a button to GND).', fix: `Set GPIO${r.trigger.pin} to INPUT_PULLUP in the pin set-up.` });
  }
  // writes to pins that are not outputs
  for (const r of prog.rules) for (const a of [...r.actions, ...r.elseActions]) {
    if (a.kind === 'digitalWrite' && prog.pins[a.pin] !== 'OUTPUT') {
      out.push({ code: 'write-not-output', severity: 'warning', title: `Rule "${r.name}" writes GPIO${a.pin}, which isn't an OUTPUT`, detail: 'digitalWrite only drives a pin after pinMode(pin, OUTPUT).', fix: `Set GPIO${a.pin} to OUTPUT in the pin set-up.` });
      break;
    }
  }

  // parts: power, ground, wiring, polarity
  for (const part of project.parts) {
    const def = getDef(part.type);
    const wired = wiresAt(c, part.id).length > 0 || c.netlist.insertions.some((i) => i.part === part.id || i.board === part.id);
    if (!wired) { out.push({ code: 'part-unwired', severity: 'info', title: `${part.label} isn't wired yet`, detail: part.type === 'breadboard' ? 'Drop leaded parts onto it and run jumper wires from its holes to the ESP32.' : 'Connect its pins to the board (or to other parts) to bring it into the circuit.', parts: [part.id] }); continue; }
    if (def.power) {
      const vccNet = net(c, part.id, def.power.vcc)!, gndNet = net(c, part.id, def.power.gnd)!;
      if (gndNet !== 0) out.push({ code: 'missing-ground', severity: 'error', title: `${part.label}: GND isn't connected to the ESP32's ground`, detail: `Without a shared ground there is no return path, so ${part.label} has no supply and its signals have no reference.`, fix: `Wire ${part.label} GND to a GND pin on the board.`, parts: [part.id] });
      const supplyPins = boardPinsOn(c, vccNet).filter((p) => p.kind === 'power');
      const gpioOnVcc = boardPinsOn(c, vccNet).find((p) => p.kind === 'gpio');
      if (vccNet === 0) out.push({ code: 'vcc-to-gnd', severity: 'error', title: `${part.label}: VCC is wired to GND`, detail: 'The supply pin is on ground, so the part gets 0 V (and the supply would be shorted if VCC also reached 3V3).', fix: 'Move the VCC wire to 3V3.', parts: [part.id] });
      else if (gpioOnVcc && !supplyPins.length) out.push({ code: 'power-from-gpio', severity: 'warning', title: `${part.label} is powered from GPIO${gpioOnVcc.gpio}`, detail: `A GPIO can only supply a few mA and is 0 V until the program drives it HIGH. ${part.label} needs about ${def.power.typicalMa} mA.`, fix: 'Power modules from the 3V3 pin.', parts: [part.id], pins: [gpioOnVcc.id] });
      else if (!supplyPins.length) out.push({ code: 'vcc-unwired', severity: 'warning', title: `${part.label}: VCC isn't connected to a supply`, detail: `${part.label} needs ${def.power.minV}–${def.power.maxV} V on VCC.`, fix: 'Wire VCC to 3V3.', parts: [part.id] });
      else if (supplyPins.some((p) => (p.volts ?? 0) > def.power!.maxV)) out.push({ code: 'device-overvoltage', severity: 'error', title: `${part.label} is on ${supplyPins[0].label}, above its ${def.power.maxV} V maximum`, detail: `It is rated ${def.power.minV}–${def.power.maxV} V; ${supplyPins[0].label} is ${supplyPins[0].volts} V. On real hardware this can destroy it.`, fix: 'Power it from 3V3.', parts: [part.id] });
      else if (supplyPins.every((p) => (p.volts ?? 0) < def.power!.minV)) out.push({ code: 'device-undervoltage', severity: 'warning', title: `${part.label} needs at least ${def.power.minV} V`, detail: `It is on ${supplyPins[0].label} (${supplyPins[0].volts} V), below its ${def.power.minV}–${def.power.maxV} V range, so it won't work properly.`, fix: def.power.minV > 3.3 ? 'Power it from VIN (5 V while on USB) instead.' : 'Use a higher supply pin.', parts: [part.id] });
    }
    if (part.type === 'led') {
      const a = net(c, part.id, 'A')!, k = net(c, part.id, 'K')!;
      const aPins = boardPinsOn(c, a), kPins = boardPinsOn(c, k);
      if ((a === 0 && k !== 0) || (aPins.some((p) => p.kind === 'gpio') && kPins.some((p) => p.kind === 'power'))) {
        out.push({ code: 'led-reversed', severity: 'warning', title: `${part.label} looks reversed`, detail: 'Current only flows from the anode (long leg) to the cathode (short leg). Here the anode faces ground, so the LED stays dark.', fix: 'Swap the two LED legs.', parts: [part.id] });
      }
    }
  }

  // breadboard: legs in the same strip are shorted together; a raised part needs its legs in holes
  for (const part of project.parts) {
    if (!(part.z ?? 0) || !getDef(part.type).insertable) continue;
    const def = getDef(part.type);
    const ins = c.netlist.insertions.filter((i) => i.part === part.id);
    const missing = def.terminals.filter((t) => !ins.some((i) => i.term === t.id));
    if (missing.length) out.push({ code: 'leg-not-in-hole', severity: 'warning', title: `${part.label}: ${missing.map((t) => t.label).join(', ')} not in a breadboard hole`, detail: 'That leg hangs over the edge or the channel, so it connects to nothing.', fix: 'Move or rotate the part so every leg lands in a hole.', parts: [part.id] });
    const internal = new Set((def.internalShorts ?? []).map(([a, b]) => [a, b].sort().join('|')));
    for (let i = 0; i < ins.length; i++) for (let j = i + 1; j < ins.length; j++) {
      const a = ins[i], b = ins[j];
      if (a.board !== b.board || stripOf(a.hole) !== stripOf(b.hole) || internal.has([a.term, b.term].sort().join('|'))) continue;
      const ta = def.terminals.find((t) => t.id === a.term)!, tb = def.terminals.find((t) => t.id === b.term)!;
      out.push({ code: 'same-strip', severity: 'warning', title: `${part.label}: ${ta.label} and ${tb.label} are in the same strip`, detail: `Both legs sit in ${stripOf(a.hole)} (holes ${a.hole} and ${b.hole}), which is one connected strip inside the breadboard, so the part is shorted out and does nothing.`, fix: 'Turn the part so its legs span two different columns (or straddle the centre channel).', parts: [part.id] });
    }
  }

  // motors, drivers and batteries
  for (const part of project.parts) {
    if (!wiresAt(c, part.id).length) continue;
    if (part.type === 'dcmotor') {
      const gp = ['M1', 'M2'].flatMap((t) => boardPinsOn(c, net(c, part.id, t)!)).find((p) => p.kind === 'gpio');
      if (gp) out.push({ code: 'gpio-drives-motor', severity: 'error', title: `${part.label} is wired straight to GPIO${gp.gpio}`, detail: `A motor needs hundreds of mA (about 1 A when stalled); a GPIO can give ~20 mA and its voltage collapses long before the motor turns. The current spikes and back-EMF from the coil can also damage the pin.`, fix: 'Drive the motor through a motor driver (e.g. the L298N) powered by a battery pack, and connect only the driver\'s IN/EN pins to GPIOs.', parts: [part.id], pins: [gp.id] });
      const supplyPin = ['M1', 'M2'].flatMap((t) => boardPinsOn(c, net(c, part.id, t)!)).find((p) => p.kind === 'power');
      if (supplyPin) out.push({ code: 'motor-on-board-supply', severity: 'warning', title: `${part.label} runs straight from the ESP32's ${supplyPin.label}`, detail: 'Motor current spikes make the board brown out and reset. It also can only run one way at full speed.', fix: 'Power motors from a separate battery through a driver; share only the ground.', parts: [part.id] });
    }
    if (part.type === 'l298n') {
      const logicOnGpio = ['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB'].some((t) => boardPinsOn(c, net(c, part.id, t)!).some((p) => p.kind === 'gpio'));
      if (logicOnGpio && net(c, part.id, 'GND') !== 0) out.push({ code: 'driver-no-common-ground', severity: 'error', title: `${part.label}: its GND isn't connected to the ESP32's GND`, detail: 'The driver reads IN/EN relative to its own ground. Without a shared ground the ESP32\'s 3.3 V signals mean nothing to it, so the motor won\'t respond.', fix: `Wire ${part.label} GND to an ESP32 GND pin (and to the battery's −).`, parts: [part.id] });
      const vsNet = net(c, part.id, 'VS')!;
      const fed = project.parts.some((q) => q.type === 'battery' && net(c, q.id, 'POS') === vsNet) || boardPinsOn(c, vsNet).some((p) => p.id === 'VIN');
      const outputsUsed = ['OUT1', 'OUT2', 'OUT3', 'OUT4'].some((t) => wiresAt(c, part.id, t).length);
      if (outputsUsed && !fed) out.push({ code: 'driver-no-supply', severity: 'warning', title: `${part.label} has no motor supply`, detail: 'The +12V terminal powers the motors. Without it the H-bridge has nothing to switch.', fix: 'Connect a battery pack: + to +12V, − to GND.', parts: [part.id] });
      else if (outputsUsed && boardPinsOn(c, vsNet).some((p) => p.id === 'VIN')) out.push({ code: 'driver-from-usb', severity: 'info', title: `${part.label} takes motor power from VIN (USB)`, detail: 'Fine for a small motor at light load, but the L298N drops ~2 V and USB can only supply ~500 mA in total.', fix: 'Use a battery pack for real loads.', parts: [part.id] });
    }
    if (part.type === 'battery') {
      const pos = net(c, part.id, 'POS')!, neg = net(c, part.id, 'NEG')!;
      if (pos === neg) out.push({ code: 'battery-short', severity: 'error', title: `${part.label} is shorted`, detail: 'Its + and − are connected directly: the cells dump their full current into the wire and get hot.', fix: 'Remove the wire joining + and −.', parts: [part.id] });
      const onBoard = boardPinsOn(c, pos);
      if (onBoard.some((p) => p.id === '3V3')) out.push({ code: 'battery-backfeed', severity: 'error', title: `${part.label} + is wired to the ESP32's 3V3 pin`, detail: 'That forces the battery voltage onto the 3.3 V rail that feeds the ESP32 itself: it will be destroyed.', fix: 'Connect the battery to the motor driver (or to VIN if it is 5–12 V), never to 3V3.', parts: [part.id] });
      const gp = onBoard.find((p) => p.kind === 'gpio');
      if (gp) out.push({ code: 'battery-on-gpio', severity: 'error', title: `${part.label} + is wired to GPIO${gp.gpio}`, detail: 'ESP32 pins tolerate at most 3.6 V.', fix: 'Remove that wire.', parts: [part.id], pins: [gp.id] });
    }
    if (part.type === 'st7735' && !wiresAt(c, part.id, 'LED').length) out.push({ code: 'tft-backlight-off', severity: 'info', title: `${part.label}: the backlight (LED pin) isn't connected`, detail: 'Without its backlight the TFT may be drawing, but you will hardly see anything.', fix: 'Wire LED to 3V3 (or to a GPIO you set HIGH).', parts: [part.id] });
  }

  // program devices vs wiring
  for (const d of prog.devices) {
    const part = project.parts.find((p) => p.id === d.part);
    if (!part) { out.push({ code: 'device-missing', severity: 'error', title: `The behaviour uses "${d.part}", which isn't on the workspace`, detail: 'A device in the behaviour set-up points at a part that was deleted.', fix: 'Remove the device in the behaviour set-up, or add the part back.' }); continue; }
    if (d.kind === 'dht') {
      const p = pinOf(c, d.pin);
      const dataNet = net(c, part.id, 'DATA')!;
      if (p && dataNet !== pinNet(c, p.id) && wiresAt(c, part.id, 'DATA').length) {
        out.push({ code: 'dht-wrong-pin', severity: 'warning', title: `${part.label} DATA is on ${describeNet(c, dataNet)}, but the behaviour reads GPIO${d.pin}`, detail: 'The sensor will never answer on the pin the program listens to.', fix: `Move the DATA wire to GPIO${d.pin} or change the sensor pin in the behaviour.`, parts: [part.id], pins: [p.id] });
      }
      if (p && !p.caps.digitalOut) out.push({ code: 'dht-input-only', severity: 'error', title: `DHT on GPIO${d.pin}: the pin must be able to output`, detail: 'The DHT protocol starts with the ESP32 pulling DATA low, which an input-only pin (34–39) cannot do.', fix: 'Use another GPIO.', parts: [part.id], pins: [p.id] });
    }
    if (d.kind === 'tft') {
      const want: [string, number][] = [['SCK', board.spiDefault.sck], ['SDA', board.spiDefault.mosi], ['CS', d.cs], ['DC', d.dc]];
      if (d.rst >= 0) want.push(['RST', d.rst]);
      if (wiresAt(c, part.id).length) for (const [t, g] of want) {
        const p = pinOf(c, g);
        if (p && net(c, part.id, t) !== pinNet(c, p.id)) out.push({ code: 'spi-not-wired', severity: 'warning', title: `${part.label}: ${t} isn't on GPIO${g}`, detail: `${t} goes to ${describeNet(c, net(c, part.id, t)!)}; the program drives ${t} on GPIO${g}.${t === 'SCK' || t === 'SDA' ? ' Hardware SPI on the ESP32 uses SCK = GPIO18 and MOSI = GPIO23.' : ''}`, fix: `Wire ${t} to GPIO${g}${t === 'SCK' || t === 'SDA' ? '' : ' (or change it in the behaviour set-up)'}.`, parts: [part.id], pins: [p.id] });
      }
      for (const g of [d.cs, d.dc, d.rst]) { const p = g >= 0 ? pinOf(c, g) : undefined; if (p && !p.caps.digitalOut) out.push({ code: 'spi-input-only', severity: 'error', title: `TFT pin on GPIO${g} can't work`, detail: 'CS, DC and RESET are outputs; GPIO34–39 are input-only.', fix: 'Pick an output-capable GPIO.', pins: [p.id] }); }
    }
    if (d.kind === 'ssd1306' || d.kind === 'bme280') {
      const sda = pinOf(c, prog.i2c.sda), scl = pinOf(c, prog.i2c.scl);
      for (const [name, pin] of [['SDA', sda], ['SCL', scl]] as const) {
        if (pin && !pin.caps.digitalOut) out.push({ code: 'i2c-input-only', severity: 'error', title: `I²C ${name} on GPIO${pin.gpio} can't work`, detail: 'I²C lines are open-drain outputs; GPIO34–39 are input-only.', fix: `Use GPIO${name === 'SDA' ? 21 : 22} (the defaults) or another output-capable pin.`, pins: [pin.id] });
      }
      const sdaNet = net(c, part.id, 'SDA')!, sclNet = net(c, part.id, 'SCL')!;
      if (sda && scl && wiresAt(c, part.id).length) {
        if (sdaNet === pinNet(c, scl.id) && sclNet === pinNet(c, sda.id)) out.push({ code: 'i2c-swapped', severity: 'error', title: `${part.label}: SDA and SCL are swapped`, detail: `The program uses SDA = GPIO${sda.gpio} and SCL = GPIO${scl.gpio}, but the wires go the other way round.`, fix: 'Swap the two wires.', parts: [part.id], pins: [sda.id, scl.id] });
        else {
          if (sdaNet !== pinNet(c, sda.id)) out.push({ code: 'i2c-not-wired', severity: 'warning', title: `${part.label}: SDA isn't on GPIO${sda.gpio}`, detail: `SDA goes to ${describeNet(c, sdaNet)}; the program uses GPIO${sda.gpio} for I²C data.`, fix: `Wire SDA to GPIO${sda.gpio} (or change the I²C pins in the behaviour).`, parts: [part.id], pins: [sda.id] });
          if (sclNet !== pinNet(c, scl.id)) out.push({ code: 'i2c-not-wired', severity: 'warning', title: `${part.label}: SCL isn't on GPIO${scl.gpio}`, detail: `SCL goes to ${describeNet(c, sclNet)}; the program uses GPIO${scl.gpio} for the I²C clock.`, fix: `Wire SCL to GPIO${scl.gpio} (or change the I²C pins in the behaviour).`, parts: [part.id], pins: [scl.id] });
        }
      }
      const addr = addrOf(part);
      if (addr !== d.address) out.push({ code: 'i2c-address', severity: 'error', title: `${part.label} is at 0x${addr.toString(16).toUpperCase()}, the behaviour uses 0x${d.address.toString(16).toUpperCase()}`, detail: 'An I²C device only answers to its own address.', fix: 'Match the address in the behaviour set-up to the module.', parts: [part.id] });
    }
  }
  // address conflicts on a shared bus (whether or not the program uses both)
  const oleds = project.parts.filter((p) => ['ssd1306', 'bme280'].includes(p.type) && wiresAt(c, p.id).length);
  for (let i = 0; i < oleds.length; i++) for (let j = i + 1; j < oleds.length; j++) {
    const a = oleds[i], b = oleds[j];
    if (addrOf(a) === addrOf(b) && net(c, a.id, 'SDA') === net(c, b.id, 'SDA') && net(c, a.id, 'SDA') !== undefined && boardPinsOn(c, net(c, a.id, 'SDA')!).length) {
      out.push({ code: 'i2c-conflict', severity: 'error', title: `${a.label} and ${b.label} share I²C address 0x${addrOf(a).toString(16).toUpperCase()}`, detail: 'Two devices on the same bus with the same address both answer at once, so neither works reliably.', fix: 'Move one module to its other address with the jumper on the back, and use that address in the behaviour.', parts: [a.id, b.id] });
    }
  }
  return out;
}

export function electricalChecks(c: ElecCtx): Issue[] {
  const out: Issue[] = [];
  const B = c.board;
  for (const p of B.pins) {
    const s = c.pins[p.id];
    if (p.kind !== 'gpio' || !s) continue;
    if (!s.floating && s.volts > B.absMaxPinVolts + 0.05) {
      const src = boardPinsOn(c, s.net).find((q) => q.id === 'VIN') ? 'VIN (5 V)' : 'something above 3.3 V';
      out.push({ code: 'gpio-overvoltage', severity: 'error', title: `GPIO${p.gpio} sees ${s.volts.toFixed(2)} V`, detail: `ESP32 pins are not 5 V tolerant (absolute maximum ${B.absMaxPinVolts} V). The pin is pulled up to ${src}. On real hardware this can damage the pin.`, fix: 'Power the module from 3V3, or add a level shifter / voltage divider.', pins: [p.id] });
    }
    const ma = Math.abs(s.ma);
    if (s.mode === 'OUTPUT' && ma > B.gpioAbsMaxMa) out.push({ code: 'gpio-overcurrent', severity: 'error', title: `GPIO${p.gpio} is asked for ${ma.toFixed(0)} mA`, detail: `That is above the ${B.gpioAbsMaxMa} mA absolute maximum: a short circuit or a load with no current-limiting resistor.`, fix: 'Add a series resistor (220 Ω–1 kΩ for an LED) or drive the load through a transistor/driver.', pins: [p.id] });
    else if (s.mode === 'OUTPUT' && ma > B.gpioRecommendedMa) out.push({ code: 'gpio-current-high', severity: 'warning', title: `GPIO${p.gpio} supplies ${ma.toFixed(0)} mA`, detail: `ESP32 pins are happiest below ~${B.gpioRecommendedMa} mA; more makes the output voltage sag and heats the chip.`, fix: 'Use a larger series resistor.', pins: [p.id] });
  }
  // two outputs fighting
  const byNet = new Map<number, PinSnapshot[]>();
  for (const s of Object.values(c.pins)) if (s.mode === 'OUTPUT' && s.gpio != null) byNet.set(s.net, [...(byNet.get(s.net) ?? []), s]);
  for (const list of byNet.values()) {
    if (list.length > 1 && new Set(list.map((s) => s.level)).size > 1) out.push({ code: 'output-conflict', severity: 'error', title: `${list.map((s) => `GPIO${s.gpio}`).join(' and ')} drive the same wire to different levels`, detail: 'One output pushes HIGH while another pulls LOW: a short circuit through both pins.', fix: 'Never wire two outputs together; make one of them an input.', pins: list.map((s) => s.id) });
  }
  const supplyMa = Math.abs(c.pins['3V3']?.ma ?? 0);
  if (supplyMa > B.regulatorMaxMa) out.push({ code: 'supply-overload', severity: 'error', title: `3V3 is supplying ${supplyMa.toFixed(0)} mA`, detail: `The on-board regulator and USB supply are good for roughly ${B.regulatorMaxMa} mA in total, and the ESP32 itself needs a few hundred mA when Wi-Fi is on.`, fix: 'Check for a short, or power big loads from a separate supply with a shared ground.', pins: ['3V3'] });
  for (const part of c.project.parts) {
    const snap = c.parts[part.id];
    if (part.type === 'led' && (snap?.visual.ma as number) > 30) out.push({ code: 'led-overcurrent', severity: 'warning', title: `${part.label} carries ${(snap.visual.ma as number).toFixed(0)} mA`, detail: 'A 5 mm LED is rated for about 20 mA. Without a series resistor the current is only limited by the pin, which overheats both.', fix: 'Put a 220 Ω–1 kΩ resistor in series with the LED.', parts: [part.id] });
    const def = getDef(part.type);
    if (def.power && snap?.supplyV != null && snap.supplyV > def.power.maxV + 0.05) out.push({ code: 'device-overvoltage', severity: 'error', title: `${part.label} gets ${snap.supplyV.toFixed(2)} V`, detail: `It is rated ${def.power.minV}–${def.power.maxV} V.`, fix: 'Power it from 3V3.', parts: [part.id] });
  }
  // watched inputs that float
  for (const r of c.project.program.rules) {
    if (!r.enabled || r.trigger.kind !== 'pinEdge') continue;
    const p = pinOf(c, r.trigger.pin);
    if (p && c.pins[p.id]?.floating && c.firmware === 'running') out.push({ code: 'floating-input', severity: 'warning', title: `GPIO${p.gpio} is floating`, detail: `Rule "${r.name}" watches GPIO${p.gpio}, but nothing holds it HIGH or LOW, so it reads noise and may trigger at random.`, fix: p.caps.pullUp ? 'Use INPUT_PULLUP with the button wired to GND, or add a pull-down resistor.' : 'Add an external pull-up or pull-down resistor (this pin has no internal ones).', pins: [p.id] });
  }
  return dedupe(out);
}

function dedupe(list: Issue[]) {
  const seen = new Set<string>();
  return list.filter((i) => { const k = `${i.code}|${i.title}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
