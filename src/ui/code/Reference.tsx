import { useState } from 'preact/hooks';
import { CLASSES, FUNCTIONS, GLOBAL_OBJECTS, HEADERS, STRING_METHODS, unsupportedFunction } from '../../sim/firmware/runtime';

const GROUPS: [string, string[]][] = [
  ['Pins', ['pinMode', 'digitalWrite', 'digitalRead', 'analogRead', 'analogReadMilliVolts', 'analogReadResolution']],
  ['Time', ['delay', 'delayMicroseconds', 'millis', 'micros', 'yield']],
  ['PWM (LEDC) and sound', ['analogWrite', 'ledcAttach', 'ledcAttachChannel', 'ledcWrite', 'ledcWriteTone', 'ledcDetach', 'ledcSetup', 'ledcAttachPin', 'ledcDetachPin', 'tone', 'noTone']],
  ['Interrupts', ['attachInterrupt', 'detachInterrupt', 'digitalPinToInterrupt', 'interrupts', 'noInterrupts']],
  ['Maths', ['map', 'constrain', 'min', 'max', 'abs', 'sq', 'pow', 'sqrt', 'sin', 'cos', 'tan', 'atan2', 'floor', 'ceil', 'round', 'fabs', 'fmod', 'isnan', 'random', 'randomSeed']],
  ['Bits and misc', ['bitRead', 'bit', 'lowByte', 'highByte', 'F', 'esp_restart']],
];

const UNSUPPORTED_FNS = ['touchRead', 'dacWrite', 'pulseIn', 'shiftOut', 'xTaskCreate', 'sprintf', 'strcpy', 'bitSet', 'esp_deep_sleep_start'];

/** What the sketch can use, generated from the same tables the compiler checks against. */
export function Reference() {
  const [q, setQ] = useState('');
  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  const fn = (name: string) => FUNCTIONS[name] && match(name + FUNCTIONS[name].doc) ? <li key={name}><code>{FUNCTIONS[name].doc}</code></li> : null;
  return (
    <div class="reference">
      <p class="fineprint">
        ESP32 Lab compiles a defined subset of Arduino C++ to bytecode and runs it against the simulated circuit. It is not
        the real ESP32 toolchain and does not emulate the Xtensa CPU: anything outside this list is reported as an error,
        never silently ignored.
      </p>
      <input class="ref-search" type="search" placeholder="Search the API" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Search the supported API" />
      {GROUPS.map(([title, names]) => {
        const items = names.map(fn).filter(Boolean);
        return items.length ? <section key={title}><h3>{title}</h3><ul class="api">{items}</ul></section> : null;
      })}
      {Object.entries(GLOBAL_OBJECTS).map(([obj, g]) => {
        const items = Object.values(CLASSES[g.cls].methods).filter((m) => match(obj + m.doc));
        return items.length ? <section key={obj}><h3>{obj} <small>(built in{g.header !== 'Arduino.h' ? `, #include <${g.header}>` : ''})</small></h3><ul class="api">{items.map((m) => <li key={m.doc}><code>{obj}.{m.doc}</code></li>)}</ul></section> : null;
      })}
      {(() => {
        const items = Object.values(STRING_METHODS).filter((m) => match('String' + m.doc));
        return items.length ? <section><h3>String</h3><ul class="api"><li><code>String s = "text"; s + value; s += value; s == "x"; s[i]</code></li>{items.map((m) => <li key={m.doc}><code>.{m.doc}</code></li>)}</ul></section> : null;
      })()}
      {Object.values(CLASSES).filter((c) => !['HardwareSerial', 'TwoWire', 'EspClass'].includes(c.name)).map((c) => {
        const items = Object.values(c.methods).filter((m) => match(c.name + m.doc));
        if (!items.length && !match(c.name)) return null;
        return (
          <section key={c.name}>
            <h3>{c.name} <small>#include &lt;{c.header}&gt;</small></h3>
            <p class="fineprint"><code>{c.ctor.doc}</code></p>
            <ul class="api">{items.map((m) => <li key={m.doc}><code>.{m.doc}</code></li>)}</ul>
          </section>
        );
      })}
      {!q && (
        <>
          <section>
            <h3>Language</h3>
            <ul class="plain">
              <li>Types: <code>bool char byte int long unsigned float double String const char*</code>, <code>uint8_t…uint64_t</code>, one-dimensional arrays, <code>const</code>, <code>static</code> locals, <code>volatile</code>.</li>
              <li>Integer maths behaves like on the ESP32: 32-bit <code>int</code>/<code>long</code>, wrap-around, integer division, unsigned comparisons.</li>
              <li>Functions (declared before or after use), <code>if/else switch for while do</code>, range-for over arrays, <code>break continue return</code>, <code>?:</code>, all C operators except pointer operators and the comma operator.</li>
              <li>Preprocessor: <code>#include</code> (supported libraries only), object-like <code>#define</code>, <code>#ifdef #ifndef #else #endif</code>.</li>
            </ul>
          </section>
          <section>
            <h3>Not supported (reported as an error)</h3>
            <ul class="plain">
              <li>Pointers (other than <code>const char*</code> text), references, <code>struct</code>/<code>class</code>/<code>enum</code>, templates, <code>new</code>, function-like macros, <code>#if</code> expressions, multi-dimensional arrays, overloading your own functions.</li>
              {UNSUPPORTED_FNS.map((f) => <li key={f}><code>{f}()</code>: {unsupportedFunction(f)}</li>)}
              {Object.entries(HEADERS).filter(([, v]) => v).slice(0, 12).map(([h, v]) => <li key={h}><code>&lt;{h}&gt;</code>: {v}</li>)}
            </ul>
          </section>
          <section>
            <h3>Timing</h3>
            <p class="fineprint">
              Simulated time, not your computer's: each bytecode step costs about 0.1 µs, <code>delay()</code> is exact,
              <code>millis()</code> counts from boot. Display and I²C transfers take no simulated time. If the page can't
              keep up, the simulation slows down (the top bar says so) rather than freezing.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
