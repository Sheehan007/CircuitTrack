# ESP32 Lab

An interactive ESP32 learning and prototyping bench in the browser.

- **Learn** – guided lessons (Blink, Push a button) with read-only Arduino-ESP32 code, live line highlighting and step
  checks that read the simulation.
- **Build** – an open bench: place parts, wire them pin to pin (or into a breadboard), configure them, then either
  **write an Arduino sketch** in the Code tab (compiled and executed against the circuit) or describe a behaviour with
  rules; run it, watch the serial monitor / GPIO / signals / net states, fix what the checks flag, and save.

Everything is drawn as hand-inked isometric figures with the [Colorfigures](https://april-zhu.com/colorfigures) engine
(MIT, vendored in `src/figures/engine/`).

> **What actually runs.** In Build mode, a project runs either an **Arduino sketch** (code mode: ESP32 Lab compiles a
> defined subset of Arduino C++ to its own bytecode and executes it against the simulated circuit; see
> [Running Arduino code](#running-arduino-code)) or **behaviour rules** (no code is executed). It never emulates the
> ESP32's Xtensa CPU or runs real firmware binaries. Lessons use behaviour rules and show the equivalent sketch.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # vitest: simulation core, figures, lessons, examples
npm run typecheck    # tsc (TypeScript 7)
npm run build        # production build in dist/
npm run poc          # rebuilds the Colorfigures bridge proof in poc/dist/
```

Requires Node 20+. No backend: projects, lesson progress and settings live in `localStorage`; projects can be exported
and imported as `.esp32lab.json`.

## What works

| Area | Status |
| --- | --- |
| Board | DOIT ESP32 DevKit V1 (30-pin): every header pin with its capabilities, roles and notes; EN and BOOT buttons; on-board GPIO2 LED; boot log, download mode, GPIO12/GPIO15 strapping effects |
| Parts | LED, RGB LED, resistor, push button, potentiometer, LDR, HC-SR501 PIR, DHT22, DHT11, BME280, SSD1306 OLED (I²C), ST7735 TFT (SPI, text/shapes/bars/sprites/your own images), active buzzer, passive buzzer (real tones, optional sound), SG90 servo, TT DC motor, L298N driver, battery pack, half-size breadboard (strips, rails, plug-in parts) |
| Build mode | drag-and-drop, wire by drag or click-click, move / rotate / duplicate / delete, undo/redo, wire colours, keyboard wiring from the inspector, pin tags, 4 view rotations, zoom/pan |
| Behaviour editor | pin set-up, devices (DHT, OLED, BME280, TFT), I²C pins, rules: *at start / every N ms / when a pin changes*, conditions with else-branches, 18 action kinds, values (numbers, variables, digitalRead, analogRead, millis, random, `map()`, simulated data feeds, list length), text lists, sprites |
| Code | Monaco editor (C++ highlighting, Arduino completions and hovers, live error markers), Run / Stop / Reset / Validate, 9 example sketches, current-line marker, crash line, "edited since upload" notice; the sketch saves with the project |
| Instruments | serial monitor (115200, timestamps, partial lines, input to `Serial.read`), GPIO inspector (mode, function, level, voltage, current), signal view (levels, PWM duty, tones over 1–30 s), wiring view per net with state (driven HIGH/LOW, PWM, driven through parts, pulled, high-Z, floating, unknown) and voltage, checks |
| Checks | short circuits, GPIO tied to a supply, missing ground, wrong / too low voltage, input-only pins used as outputs, missing internal pulls on GPIO34–39, UART0 pins, strapping pins, floating inputs, GPIO over-current and over-voltage (5 V tolerance), LED without resistor / reversed, output conflicts, I²C wiring / swapped SDA–SCL / address conflicts, SPI wiring, motor driven straight from a GPIO, driver without common ground or supply, battery shorts / back-feeding 3V3, breadboard legs in one strip or not in a hole |
| Simulation | run, pause, step to the next event, deterministic reset, speed 0.25–10× |
| Projects | blank board (code mode with a starter sketch), 6 code demos + 11 behaviour examples, save automatically, rename, duplicate, export, import; projects saved before code mode keep running their rules |
| Learn | Blink and Push-a-button lessons with live step checks, parameter choosers that re-upload, "Open in Build" |

Code demos (each verified end to end in `tests/firmware-demos.test.ts`): Blink, button → LED, PWM dimmer (knob →
`ledcWrite`), buzzer melody (`tone`), servo controller (ESP32Servo), weather station (BME280 + SSD1306 with the Adafruit
libraries).

Behaviour examples (all ordinary editable projects): home weather station (DHT22 + OLED), button → LED, weather station
(BME280 + TFT), crypto ticker (**simulated** prices, labelled on screen), lyric display, servo gate, DC motor speed and
direction, temperature fan and alarm, night light (LDR), motion alarm (PIR), RGB mood light.

## Architecture

```
src/
  sim/                       headless simulation core: no DOM, no rendering
    boards/                  board profiles (DOIT DevKit V1: pins, capabilities, physical positions, constraints)
    components/              component models: terminals, params, power needs, electrical elements, interactions
    devices/                 device models (runtime state, ticks, readings), framebuffers, font, sprites
    program/                 behaviour program types, runner (on the HAL), Arduino code generator
    firmware/                Arduino-C++ subset: lexer + preprocessor, parser, compiler, bytecode VM, runtime library
                             (the supported API), Adafruit-GFX text/graphics, printf, and the runner that executes a
                             compiled sketch on the engine's clock
    netlist.ts               circuit graph: wires + internal shorts + breadboard insertions → nets
    solver.ts                DC nodal solver (resistors, switches, sources, piecewise-linear diodes)
    engine.ts                virtual clock + HAL + solve + device models + program; snapshots for the UI
    checks.ts                static and electrical connection checks with explanations
    clock.ts, feeds.ts, hal.ts, project.ts
  figures/                   visual layer: Colorfigures engine (vendored), part drawers, scene composer
  content/                   lessons and example projects (pure data + the same engine)
  app/                       store, engine host (requestAnimationFrame loop), actions (undo, autosave), storage, audio
  ui/                        Preact components: bench, inspector, behaviour editor, code, pinout, instruments
    code/                    sketch editor (Monaco, lazy-loaded), Arduino completions/hovers, API reference
poc/                         Colorfigures proof of concept (standalone figure page + host page)
tests/                       vitest suites
```

- **One engine, two modes.** Lessons, templates and blank projects are all `Project` documents (board placement,
  parts, wires, behaviour program) run by the same `Engine`. A lesson just builds its project and code from a few
  parameters.
- **Two runners, one circuit.** The engine runs either the behaviour `ProgramRunner` (rules, through the `Hal`
  interface) or the `FirmwareRunner` (a compiled sketch, through `FirmwareTarget`). Both only touch the circuit through
  the engine's pin, PWM, tone, servo, serial and device methods, so wiring, checks, instruments and figures are shared.
- **Structured behaviours.** Rules are data (`src/sim/program/types.ts`); their generated sketch compiles and runs in
  code mode (tested for every example), so a rules project can be converted to code.
- **Visual layer is read-only.** The figures render a project and a snapshot; they never change simulator state.
  Interaction goes UI → actions/host → engine.

## The simulation model (and its simplifications)

The electrical model is deliberately teaching-grade but internally consistent: the same solved circuit drives LED
brightness, pin readings, check messages and the inspector numbers.

- **DC operating point only.** Nodal analysis with linear resistors, ideal-ish switches (0.05 Ω), voltage sources with
  series resistance, and piecewise-linear diodes (Vf + Rs). No capacitance, inductance or transients; no switch bounce.
- **GPIO**: outputs are 3.3 V / 0 V sources behind 40 Ω; inputs are high-impedance; internal pulls are 45 kΩ (absent on
  GPIO34–39). Logic threshold 1.65 V. A pin with no resistive path to a source is *floating* and reads seeded noise.
- **PWM** is time-averaged by decomposition: all PWM pins LOW as a base, plus each pin HIGH on its own weighted by its
  duty. Exact for independent branches (an LED or RGB channel per pin), approximate when PWM'd branches interact.
- **ADC** is linear 0–3.3 V → 0–4095 (the real ESP32 ADC is non-linear near the rails and attenuation-dependent).
- **Power**: 3V3 is a 3.3 V source (0.2 Ω), VIN is 5 V while "on USB". Module supply current is a constant-resistance
  load. The SSD1306 module's regulator, the L298N's 5 V regulator and logic inputs, and the PIR output are modelled
  with a two-pass solve (modules react to the first pass's voltages).
- **Protocols are logical, not electrical.** I²C, SPI and the DHT single-wire protocol are not bit-banged: a read or a
  draw succeeds when the device is powered, wired to the pins the program uses, at the right address, with no address
  conflict; otherwise it fails with the reason. Timing limits (DHT 2 s / 1 s) are enforced.
- **Motors and servos**: a TT motor is a winding resistance with back-EMF folded into an equivalent resistance that
  depends on the load setting; speed follows voltage and load with a first-order lag. An SG90 follows a 544–2400 µs
  pulse at 0.1 s/60° (slower below 4.8 V; it does not move below 4 V). The L298N drops ~1.4 V and needs > 2.3 V on its
  inputs relative to its own ground.
- **Boot**: GPIO0 LOW at reset → download mode; GPIO12 driven HIGH at reset → boot failure; GPIO15 driven LOW silences
  the ROM log. The boot log text is representative, not byte-exact.
- **Time** is virtual. Events run in a deterministic order on one clock (sketch slices, rules, timers, device ticks
  every 20 ms), so a reset with the same inputs gives the same run. Behaviour actions are instantaneous.
- **Not modelled yet**: Wi-Fi/BLE, deep sleep, touch, DAC, FreeRTOS tasks, current limits of the USB supply beyond a
  simple budget check. (Interrupts are supported in code mode.)

## Running Arduino code

A sketch is compiled by ESP32 Lab itself (`src/sim/firmware/`), not by the ESP32 toolchain, and runs on a small
bytecode VM, not on an emulated Xtensa CPU. The subset is defined, checked and documented; anything outside it is a
compile error with a line number and a reason, never silently ignored or approximated. User code is never turned into
JavaScript or evaluated by the browser.

```
source ─ preprocess (#include, #define, #ifdef) ─ lex ─ parse (AST) ─ compile (types, checks, bytecode)
        └──────────────── diagnostics (errors / warnings, line:col) → editor markers + problems list
bytecode ─ VM (resumable threads, instruction budget) ─ FirmwareRunner (slices on the virtual clock, interrupts)
        └─ runtime natives (pinMode, ledcWrite, Serial, Wire, Adafruit_SSD1306, …) ─ FirmwareTarget ─ Engine
```

**Language.** `bool char byte int long unsigned float double String const char*`, `uint8_t…uint64_t`, one-dimensional
arrays (with initialisers, `sizeof`, range-for), `const`, `static` locals, `volatile`; functions in any order (Arduino
generates prototypes); `if/else switch for while do break continue return ?:`, all C arithmetic, bit, comparison,
logical and assignment operators, `++/--`, C and functional casts. Integer maths follows the ESP32: 32-bit `int`/`long`,
wrap-around, truncating division, unsigned comparisons, integer promotion of `byte`/`char`; `float` is 32-bit.
`String` supports `+`, `+=`, `==`, `[]` and the common methods. Errors a C++ compiler would catch, or that would
silently misbehave on a real board (`"T = " + 5`, comparing two `char*`), are reported. Not supported: pointers (except
`const char*` text), references, `struct`/`class`/`enum`, templates, `new`, function-like macros, `#if` expressions,
multi-dimensional arrays, overloading user functions, the comma operator.

**API** (the full list is generated from `src/sim/firmware/runtime.ts` in the editor's *Reference* tab, and drives
completions):

- Pins and time: `pinMode` (INPUT, OUTPUT, INPUT_PULLUP, INPUT_PULLDOWN), `digitalWrite/Read`, `analogRead`
  (12-bit, `analogReadResolution`), `analogReadMilliVolts`, `delay`, `delayMicroseconds`, `millis`, `micros`.
- PWM and sound: `analogWrite`, LEDC core 3.x (`ledcAttach`, `ledcAttachChannel`, `ledcWrite`, `ledcWriteTone`,
  `ledcDetach`) **and** core 2.x (`ledcSetup`, `ledcAttachPin`, `ledcWrite(channel, …)`, `ledcDetachPin`), `tone`,
  `noTone`.
- Interrupts: `attachInterrupt(digitalPinToInterrupt(pin), isr, RISING|FALLING|CHANGE)`, `detachInterrupt`.
- `Serial` (`begin print println printf write available read peek readString readStringUntil parseInt parseFloat`),
  `Wire` (`begin(sda, scl)`, `beginTransmission`, `endTransmission` → real ACK/NACK from the wiring), `ESP.restart()`.
- Maths and helpers: `map constrain min max abs sq pow sqrt sin cos … random randomSeed bitRead bit lowByte highByte F`.
- Libraries: `Adafruit_SSD1306` + Adafruit-GFX text and drawing, `Adafruit_ST7735` (hardware SPI), `Adafruit_BME280`,
  `DHT` (DHT11/DHT22), `ESP32Servo` (`Servo`).

**Execution and timing.** Each bytecode instruction costs 0.1 µs of simulated time (roughly an ESP32 at 240 MHz), so
`millis()` advances inside busy loops; `delay()` ends the current slice and resumes exactly when the delay is over.
Slices are at most 2 ms of simulated time and are scheduled on the same virtual clock as everything else, so a sketch
and the circuit stay in lock-step and runs are deterministic. The browser gives each frame a wall-clock budget: a heavy
sketch makes simulated time run slower than real time (the top bar says so), it never freezes the page. Interrupt
handlers run on their own short thread when an attached pin changes, even while `loop()` is in `delay()`; `delay()` in
an ISR, or an ISR running over 300 ms, is a crash, as on the chip.

**Faults.** Division by zero, array index out of bounds and runaway recursion stop the sketch at the line, with an
explanation (a real board would print a Guru Meditation backtrace and reboot). `Serial.print` before `Serial.begin`
prints nothing and says why.

**Devices.** A sketch finds parts by wiring and address, like real hardware: the OLED or BME280 that answers at the
sketch's I²C address on the sketch's `Wire` pins; the DHT on the sketch's data pin; the TFT on the sketch's CS/DC/RST
with hardware SPI. A part that is unpowered, unwired, on other pins or at another address does not respond (begin()
fails or nothing is drawn) and the Checks tab says why.

**Limitations.** Only the API above. No Wi-Fi/BLE, FreeRTOS tasks, deep sleep, touch, DAC, `pulseIn`, EEPROM or file
systems. Peripheral transfers (I²C, SPI, the DHT protocol, display refreshes) take no simulated time and are not
bit-level. `Serial` has no baud-rate effects or buffer limits. Floats are evaluated with JavaScript doubles rounded to
32 bits after each operation. 64-bit integers are exact up to 2^53. The editor's current-line marker is approximate
inside tight loops.

## Colorfigures integration

**Proof first.** `poc/` builds the ESP32 board as a standalone Colorfigures page (the engine's own `mountFigure` shell:
drag to turn, labels, colour swatches) and a host page that embeds it in an iframe. The host pushes simulator state in
with `postMessage({ type: 'cf:state', state })`. The figure emits `cf:event` messages (`press`/`release` for EN and BOOT,
`terminal` for pins). Verified headlessly: pushing `led2: 1` adds the LED glow layers (3 → 6), and synthetic presses
produce `press:EN`, `release:EN` and `terminal:GPIO23`. Run `npm run poc`, serve `poc/dist/`, open `host.html?auto=1`.

**Decision.** The iframe bridge works for a single figure, but a bench needs wires between parts in one projection,
shared hit-testing, and drag-and-drop. So the app vendors `core.js` as an ES module (exports and frame setters appended,
upstream code untouched) and composes one SVG scene from per-part drawers written to the skill's drawing contract.
`src/figures/` only reads simulator snapshots.

Constraints found along the way:

1. **Global-script engine.** `core.js` declares ~100 globals and `mountFigure()` takes over `document.body`. It is
   vendored as a module, and the app never calls `mountFigure`.
2. **Mirror-handed projection.** The camera basis satisfies R × U = −V, so seen from above, +y is the viewer's left.
   Chirality matters (the DOIT pin order, OLED/TFT pixel columns, module pin order), and a test guards the board's
   handedness.
3. **Depth sorting.** `byDepth` sorts every pair with `Array.sort`. Pairs that never overlap on screen then impose
   contradictory constraints, which scrambled flat assemblies like the PCB. The app uses an overlap-aware topological
   sort (convex-hull SAT test, then Kahn's algorithm) in `src/figures/lib.ts`.
4. **No depth buffer.** Wires are drawn above everything (they arc over parts like real jumpers). Parts on a
   breadboard carry their shadow inside their own group.
5. **Per-part rotation via the camera.** Drawing a part rotated by r equals drawing it unrotated with the camera at
   yaw − r. Placement is a screen-space translate (the projection is affine). A test checks that every drawn pin target
   lands exactly where wires attach, for all rotations and views.
6. **Hand-drawn filter cost.** The SVG displacement filter is applied per part. Pixel content (OLED/TFT images, LED
   glows) goes in an unfiltered overlay so it stays crisp, and the wobble can be turned off in Settings.
7. **Text on faces** is hidden when mirrored. Silkscreen uses `txZ`, which picks a readable direction.
8. **Throttled frames.** In hidden panes the browser throttles `requestAnimationFrame`, so the simulation loop also
   uses a timer fallback, the same approach the engine uses.

The figures follow the skill's look: three-tone shading per face, a heavy silhouette ink, a flat blue cast shadow,
warm paper, and every part boxed and sorted. `scripts/contact-sheet.test.ts` renders every part from four sides for
review (`npx vitest run --config scripts/vitest.sheet.config.ts`).

## Board data sources

Header order and capabilities were checked against the
[Mischianti DOIT pinout](https://mischianti.org/doit-esp32-dev-kit-v1-high-resolution-pinout-and-specs/),
[espboards.dev](https://www.espboards.dev/esp32/esp32doit-devkit-v1/) and the
[ESP-IDF GPIO reference](https://docs.espressif.com/projects/esp-idf/en/v4.4.6/esp32/api-reference/peripherals/gpio.html).
Physical layout details (header row spacing, chip placement) are visual approximations.

## What remains

- More lessons (knob + ADC, PWM fading, OLED, sensors, motors).
- Wi-Fi/BLE projects, including an optional live data source for the ticker. `registerFeed()` is the hook.
- More of the Arduino API in code mode (`pulseIn`, `shiftOut`, structs, `sprintf` into buffers), a pin-level logic
  analyser for I²C/SPI, and Wi-Fi/BLE once networking is simulated.
- Other boards (DevKitC, S3, C3, C6) as additional `BoardProfile`s and board figures.
- Breadboard niceties: wire routing on the board, a full-size board, and seating the ESP32 across two boards.
- Transient effects (debounce, RC timing, motor inrush), ADC non-linearity, Wi-Fi/ADC2 interaction.
