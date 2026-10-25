import { describe, expect, it } from 'vitest';
import { BLINK, BUTTON_INTERRUPT } from '../src/content/sketches';
import { compileSketch } from '../src/sim/firmware/compiler';
import { Engine } from '../src/sim/engine';
import { out, runSketch, sketchProject } from './fwhelpers';

const errs = (src: string) => compileSketch(src).diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.line}: ${d.message}`);
const warns = (src: string) => compileSketch(src).diagnostics.filter((d) => d.severity === 'warning').map((d) => `${d.line}: ${d.message}`);
const wrap = (body: string, globals = '') => `${globals}\nvoid setup() { Serial.begin(9600);\n${body}\n}\nvoid loop() { delay(1000); }`;
/** Run a sketch on a bare board for `ms` and return what it printed. */
const printed = (src: string, ms = 10) => { const e = runSketch(sketchProject(src, {}, [])); e.advance(ms); return out(e); };

describe('compiler: honest errors with line numbers', () => {
  it('needs setup() and loop()', () => {
    expect(errs('void setup() {}')[0]).toMatch(/void loop\(\)/);
  });
  it('reports a missing semicolon on the right line', () => {
    const e = errs('void setup() {\n  int x = 1\n  x++;\n}\nvoid loop() {}');
    expect(e.length).toBeGreaterThan(0);
    expect(e[0]).toMatch(/^2: Expected ';'/);
  });
  it('rejects unsupported libraries and functions with a reason', () => {
    expect(errs('#include <WiFi.h>\nvoid setup(){}\nvoid loop(){}')[0]).toMatch(/^1: .*Wi-Fi is not simulated/);
    expect(errs('#include <Servo.h>\nvoid setup(){}\nvoid loop(){}')[0]).toMatch(/ESP32Servo/);
    expect(errs(wrap('xTaskCreate(0);'))[0]).toMatch(/xTaskCreate\(\) is not supported.*FreeRTOS/);
    expect(errs(wrap('touchRead(4);'))[0]).toMatch(/touch/i);
  });
  it('rejects C++ features outside the subset instead of guessing', () => {
    expect(errs('struct P { int x; };\nvoid setup(){}\nvoid loop(){}').join()).toMatch(/[Ss]truct/);
    expect(errs(wrap('int* p = 0;')).join()).toMatch(/[Pp]ointer/);
    expect(errs(wrap('auto x = 3;')).join()).toMatch(/auto/);
  });
  it('catches type errors a C++ compiler would catch (or that would silently misbehave)', () => {
    expect(errs(wrap('Serial.println("T = " + 5);')).join()).toMatch(/String\(/);
    expect(errs(wrap('int x = "hello";')).join()).toMatch(/text/i);
    expect(errs(wrap('undefinedThing = 3;')).join()).toMatch(/'undefinedThing' was not declared/);
    expect(errs(wrap('digitalWrit(2, HIGH);')).join()).toMatch(/Did you mean 'digitalWrite'/);
    expect(errs(wrap('pinMode(2);')).join()).toMatch(/pinMode\(\) takes 2 arguments/);
    expect(errs(wrap('const int a = 1; a = 2;')).join()).toMatch(/const/);
  });
  it('a class needs its header', () => {
    expect(errs('Adafruit_BME280 bme;\nvoid setup(){}\nvoid loop(){}').join()).toMatch(/#include <Adafruit_BME280.h>/);
  });
  it('warns about classic mistakes', () => {
    expect(warns(wrap('int x = 0; if (x = 5) {}')).join()).toMatch(/did you mean ==/);
    expect(warns('int f() { }\nvoid setup(){}\nvoid loop(){}').join()).toMatch(/without returning/);
  });
});

describe('C semantics', () => {
  it('integer division, wrap-around, unsigned, char, float printing', () => {
    expect(printed(wrap(`
      Serial.println(7 / 2);
      Serial.println(-7 / 2);
      Serial.println(7 % 3);
      Serial.println(7.0 / 2);
      int big = 2147483647; big++; Serial.println(big);
      unsigned long u = 0; u--; Serial.println(u);
      byte b = 250; b += 10; Serial.println(b);
      char c = 'A'; c++; Serial.println(c);
      Serial.println(1.0 / 3, 4);
      Serial.println(255, HEX);
      Serial.println(5, BIN);
      Serial.println((int)3.99);
      Serial.println(10 > 3 && 2 > 5);
    `))).toEqual(['3', '-3', '1', '3.50', '-2147483648', '4294967295', '4', 'B', '0.3333', 'FF', '101', '3', '0']);
  });
  it('Strings, arrays, functions, switch, loops, static locals', () => {
    expect(printed(`
      int squares[5];
      int square(int x) { return x * x; }
      String label(int n) {
        switch (n) { case 1: return "one"; case 2: return "two"; default: return "many"; }
      }
      int counter() { static int n = 0; n++; return n; }
      void setup() {
        Serial.begin(115200);
        for (int i = 0; i < 5; i++) squares[i] = square(i);
        int total = 0;
        for (int v : squares) total += v;
        Serial.println(total);
        String s = "Temp: ";
        s += 21.5;
        s += " C";
        Serial.println(s);
        Serial.println(label(1) + "/" + label(2) + "/" + label(7));
        String t = "  Hello  "; t.trim(); t.toUpperCase();
        Serial.println(t + " " + t.length() + " " + t.indexOf("LL"));
        int k = 0; while (true) { if (++k >= 3) break; }
        do { k += 10; } while (k < 30);
        Serial.println(k);
        counter(); counter();
        Serial.println(counter());
        Serial.printf("%5.2f|%-4d|%04X|%s\\n", 3.14159, 42, 255, "ok");
      }
      void loop() { delay(1000); }
    `)).toEqual(['30', 'Temp: 21.50 C', 'one/two/many', 'HELLO 5 2', '33', '3', ' 3.14|42  |00FF|ok']);
  });
  it('#define, #ifdef and sizeof work like the preprocessor', () => {
    expect(printed(`
      #define LED 23
      #define DEBUG
      int arr[] = {1, 2, 3, 4};
      void setup() {
        Serial.begin(115200);
      #ifdef DEBUG
        Serial.println(LED);
      #else
        Serial.println("no");
      #endif
        Serial.println(sizeof(arr) / sizeof(arr[0]));
      }
      void loop() {}
    `)).toEqual(['23', '4']);
  });
});

describe('timing: delay, millis, busy loops', () => {
  it('millis() follows simulated time and delay() is exact', () => {
    const e = runSketch(sketchProject(`
      void setup() { Serial.begin(115200); }
      void loop() { Serial.println(millis()); delay(250); }
    `, {}, []));
    // each pass through loop() also takes a few µs of CPU time, so the 5th line is due just after t = 1000 ms
    e.advance(1001);
    expect(out(e)).toEqual(['0', '250', '500', '750', '1000']);
    expect(e.serial.filter((l) => l.kind === 'out')[4].t).toBeGreaterThan(1000);
    expect(e.serial.filter((l) => l.kind === 'out')[4].t).toBeLessThan(1000.01);
  });
  it('a busy loop costs simulated time (≈0.1 µs per instruction) and never freezes the host', () => {
    const e = runSketch(sketchProject(`
      unsigned long n = 0;
      void setup() { Serial.begin(115200); }
      void loop() { n++; if (millis() >= 100 && n > 0) { Serial.println(n > 1000 ? "fast" : "slow"); while (true) { n++; } } }
    `, {}, []));
    const t0 = performance.now();
    e.advance(1000, 200);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(out(e)).toEqual(['fast']);
    expect(e.snapshot().firmware).toBe('running');
    expect(e.snapshot().fw.line).toBeGreaterThan(0);
  });
  it('the wall-clock budget slows the simulation down instead of blocking', () => {
    const e = runSketch(sketchProject(`void setup() {}\nvoid loop() { }`, {}, []));
    e.advance(10_000, 5);
    const s = e.snapshot();
    expect(s.fw.realtime).toBe(false);
    expect(s.t).toBeLessThan(10_000);
  });
});

describe('runtime faults stop the sketch at the line', () => {
  it('division by zero', () => {
    const e = runSketch(sketchProject(`int zero = 0;\nvoid setup() { Serial.begin(115200); }\nvoid loop() {\n  delay(100);\n  int x = 10 / zero;\n}`, {}, []));
    e.advance(500);
    const s = e.snapshot();
    expect(s.firmware).toBe('crashed');
    expect(s.fw.fault).toMatchObject({ line: 5 });
    expect(s.fw.fault!.message).toMatch(/Division by zero/);
    expect(s.issues.some((i) => i.code === 'firmware-fault')).toBe(true);
  });
  it('array out of bounds', () => {
    const e = runSketch(sketchProject(`int a[3];\nvoid setup() {\n  for (int i = 0; i <= 3; i++) a[i] = i;\n}\nvoid loop() {}`, {}, []));
    e.advance(10);
    expect(e.snapshot().fw.fault).toMatchObject({ line: 3 });
  });
  it('runaway recursion', () => {
    const e = runSketch(sketchProject(`int f(int x) { return f(x + 1); }\nvoid setup() { f(0); }\nvoid loop() {}`, {}, []));
    e.advance(10);
    expect(e.snapshot().fw.fault!.message).toMatch(/Stack overflow/);
  });
});

describe('lifecycle', () => {
  const blink = () => sketchProject(BLINK, { r1: { type: 'resistor', params: { ohms: 220 } }, led1: 'led' },
    [['esp32.GPIO23', 'r1.1'], ['r1.2', 'led1.A'], ['led1.K', 'esp32.GND_R']]);

  it('reset stops the sketch: pins go high-Z, time and history clear; Run starts it again from setup()', () => {
    const e = runSketch(blink());
    e.advance(1500);
    e.reset();
    let s = e.snapshot();
    expect(s.firmware).toBe('none');
    expect(s.t).toBe(0);
    expect(s.pins.GPIO23.mode).toBe('UNSET');
    expect(s.nets[s.pins.GPIO23.net].state).toBe('high-z');
    expect(e.history.size).toBe(0);
    e.start();
    e.advance(10);
    s = e.snapshot();
    expect(s.pins.GPIO23.level).toBe(1);
    expect(out(e)[0]).toBe('Blink started');
  });

  it('editing the circuit while running keeps the sketch running (no restart)', () => {
    const p = blink();
    const e = runSketch(p);
    e.advance(500);
    e.setProject({ ...p, parts: p.parts.map((x) => (x.id === 'r1' ? { ...x, params: { ohms: 1000 } } : x)) });
    e.advance(10);
    const s = e.snapshot();
    expect(s.firmware).toBe('running');
    expect(out(e).filter((l) => l === 'Blink started').length).toBe(1);
    expect(s.parts.led1.visual.ma as number).toBeCloseTo(1.24, 1);
  });

  it('editing the source does not restart the board; the snapshot still reports the uploaded sketch', () => {
    const p = blink();
    const e = runSketch(p);
    e.advance(100);
    e.setProject({ ...p, firmware: { source: '// edited' } });
    e.advance(100);
    expect(e.snapshot().firmware).toBe('running');
    expect(e.snapshot().fw.uploaded).toBe(BLINK);
  });

  it('EN reset reboots the uploaded sketch', () => {
    const e = runSketch(blink());
    e.advance(100);
    e.interact('esp32', 'en', true);
    expect(e.snapshot().firmware).toBe('reset-held');
    expect(e.snapshot().pins.GPIO23.mode).toBe('UNSET');
    e.interact('esp32', 'en', false);
    e.advance(5);
    expect(e.snapshot().firmware).toBe('running');
    expect(out(e).filter((l) => l === 'Blink started').length).toBe(2);
  });

  it('save → reload → run gives the same result (deterministic)', () => {
    const p = JSON.parse(JSON.stringify(blink()));
    const a = runSketch(p); a.advance(3500);
    const b = runSketch(JSON.parse(JSON.stringify(p))); b.advance(3500);
    expect(b.history.get(23)).toEqual(a.history.get(23));
  });

  it('an old project without runMode keeps running its behaviour rules', () => {
    const p = blink();
    delete p.runMode;
    const e = new Engine(p);
    e.start();
    e.advance(10);
    expect(e.snapshot().fw.mode).toBe('rules');
  });
});

describe('interrupts and serial input', () => {
  it('attachInterrupt(FALLING) runs the handler on each press, even while loop() sleeps', () => {
    const e = runSketch(sketchProject(BUTTON_INTERRUPT, { btn1: 'button', r1: { type: 'resistor', params: { ohms: 220 } }, led1: 'led' },
      [['btn1.1a', 'esp32.GPIO4'], ['btn1.2b', 'esp32.GND_R'], ['esp32.GPIO23', 'r1.1'], ['r1.2', 'led1.A'], ['led1.K', 'esp32.GND_R']]));
    e.advance(20);
    for (let i = 0; i < 3; i++) { e.interact('btn1', 'pressed', true); e.advance(20); e.interact('btn1', 'pressed', false); e.advance(20); }
    expect(out(e)).toEqual(['presses: 1', 'presses: 2', 'presses: 3']);
    expect(e.snapshot().pins.GPIO23.level).toBe(1);
  });

  it('Serial.available / readStringUntil read what the monitor sends', () => {
    const e = runSketch(sketchProject(`
      void setup() { Serial.begin(115200); }
      void loop() {
        if (Serial.available()) { String cmd = Serial.readStringUntil('\\n'); cmd.trim(); Serial.println("got " + cmd); }
        delay(10);
      }`, {}, []));
    e.advance(50);
    e.serialInput('led on\n');
    e.advance(50);
    expect(out(e)).toEqual(['got led on']);
  });

  it('print() without a newline continues the same line', () => {
    expect(printed(wrap('Serial.print("a"); Serial.print(1); Serial.println("b"); Serial.print("c");'))).toEqual(['a1b', 'c']);
  });

  it('Serial.print before Serial.begin prints nothing and says why', () => {
    const e = runSketch(sketchProject('void setup() { Serial.println("hi"); }\nvoid loop() {}', {}, []));
    e.advance(10);
    expect(out(e)).toEqual([]);
    expect(e.snapshot().issues.some((i) => i.code === 'serial-not-started')).toBe(true);
  });
});

describe('invalid wiring and disconnected parts', () => {
  it('a sketch driving GPIO23 with nothing wired: the pin is HIGH, nothing else happens', () => {
    const e = runSketch(sketchProject(BLINK, { led1: 'led' }, []));
    e.advance(10);
    const s = e.snapshot();
    expect(s.pins.GPIO23.volts).toBeGreaterThan(3.2);
    expect(s.parts.led1.visual.brightness).toBe(0);
    expect(s.issues.some((i) => i.code === 'part-unwired')).toBe(true);
  });
  it('OUTPUT on an input-only pin is reported, and the LED stays dark', () => {
    const src = BLINK.replace('LED_PIN = 23', 'LED_PIN = 34');
    const e = runSketch(sketchProject(src, { r1: { type: 'resistor', params: { ohms: 220 } }, led1: 'led' },
      [['esp32.GPIO34', 'r1.1'], ['r1.2', 'led1.A'], ['led1.K', 'esp32.GND_R']]));
    e.advance(10);
    const s = e.snapshot();
    expect(s.issues.some((i) => i.code === 'input-only-output')).toBe(true);
    expect(s.parts.led1.visual.brightness).toBe(0);
  });
  it('a sketch that reads a floating pin gets noise and a warning', () => {
    const e = runSketch(sketchProject(wrap('pinMode(4, INPUT); Serial.println(digitalRead(4) >= 0);'), {}, []));
    e.advance(10);
    expect(e.snapshot().issues.some((i) => i.code === 'floating-input')).toBe(true);
    expect(e.snapshot().nets[e.snapshot().pins.GPIO4.net].state).toBe('high-z');
  });
});

describe('the editor knows which line runs', () => {
  it('while sleeping, the current line is the delay() call', () => {
    const e = runSketch(sketchProject(BLINK, {}, []));
    e.advance(10);
    const lines = BLINK.split('\n');
    expect(lines[e.snapshot().fw.line! - 1].trim()).toBe('delay(1000);');
    expect(e.snapshot().fw.line).toBe(lines.findIndex((l) => l.includes('delay(1000)')) + 1);
  });
});
