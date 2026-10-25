/*
  Arduino-ESP32 (core 3.x) sketch equivalent to a behaviour program. Shown read-only next to the behaviour editor so
  people can see what their rules would look like as code. ESP32 Lab simulates the behaviour; it does not compile or
  run this code. Libraries named are the usual ones: Adafruit SSD1306 / ST7735 / BME280 / GFX, DHT sensor library,
  ESP32Servo.
*/
import type { Action, Condition, Program, Rule, Value } from './types';
import { builtinSprite, customSprite } from '../devices/sprites';
import { rgb565 } from '../devices/colorFramebuffer';
import { FEED_IDS, getFeed } from '../feeds';

const ident = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');

function value(v: Value): string {
  switch (v.kind) {
    case 'num': return String(v.value);
    case 'var': return ident(v.name);
    case 'digitalRead': return `digitalRead(${v.pin})`;
    case 'analogRead': return `analogRead(${v.pin})`;
    case 'millis': return 'millis()';
    case 'random': return `random(${v.min}, ${v.max + 1})`;
    case 'feed': return `simulatedPrice_${ident(v.feed)}()`;
    case 'listLen': return `${ident(v.list)}_count`;
    case 'map': return `map(${value(v.value)}, ${v.inMin}, ${v.inMax}, ${v.outMin}, ${v.outMax})`;
  }
}

/** "#rrggbb" → an RGB565 literal like the Adafruit libraries use. */
const c565 = (hex: string) => {
  const [r, g, b] = rgb565(hex);
  return `0x${(((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)).toString(16).toUpperCase().padStart(4, '0')}`;
};

const cond = (c: Condition) => `${value(c.left)} ${c.op} ${value(c.right)}`;

/** "{temp:1} C {lyrics[i]}" → a list of print calls on `target`. */
function printParts(text: string, target: string, degreeAsCp437: boolean): string[] {
  const out: string[] = [];
  const lit = (s: string) => {
    if (!s) return;
    const pieces = s.split('°');
    pieces.forEach((piece, i) => {
      if (piece) out.push(`${target}.print(${JSON.stringify(piece)});`);
      if (i < pieces.length - 1) out.push(degreeAsCp437 ? `${target}.write(247);  // °` : `${target}.print("°");`);
    });
  };
  const re = /\{([a-zA-Z_]\w*)(?:\[([a-zA-Z_]\w*|\d+)\]|:(\d))?\}/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    lit(text.slice(last, m.index));
    const [, name, idx, dec] = m;
    if (idx != null) out.push(`${target}.print(${ident(name)}[(int)${/^\d+$/.test(idx) ? idx : ident(idx)} % ${ident(name)}_count]);`);
    else if (name === 'millis') out.push(`${target}.print(millis());`);
    else out.push(`${target}.print(${ident(name)}${dec != null ? `, ${dec}` : ''});`);
    last = m.index + m[0].length;
  }
  lit(text.slice(last));
  return out;
}

const spriteMask = (name: string) => `sprite_${ident(name)}_mask`;

function action(a: Action, p: Program): string[] {
  const dev = (id: string) => ident(p.devices.find((x) => x.id === id)?.id ?? id);
  switch (a.kind) {
    case 'digitalWrite':
      return a.value === 'TOGGLE' ? [`digitalWrite(${a.pin}, !digitalRead(${a.pin}));`] : [`digitalWrite(${a.pin}, ${a.value});`];
    case 'pwmWrite': return [`analogWrite(${a.pin}, ${value(a.duty)});`];
    case 'setVar': return [a.op === 'add' ? `${ident(a.name)} += ${value(a.value)};` : `${ident(a.name)} = ${value(a.value)};`];
    case 'readDht': {
      const o = dev(a.device);
      return [`${ident(a.temp)} = ${o}.readTemperature();`, `${ident(a.hum)} = ${o}.readHumidity();`, `if (isnan(${ident(a.temp)}) || isnan(${ident(a.hum)})) Serial.println("Failed to read from DHT sensor!");`];
    }
    case 'readBme': {
      const o = dev(a.device);
      return [`${ident(a.temp)} = ${o}.readTemperature();`, `${ident(a.hum)} = ${o}.readHumidity();`, `${ident(a.pres)} = ${o}.readPressure() / 100.0;  // Pa → hPa`];
    }
    case 'oledClear': return [`${dev(a.device)}.clearDisplay();`];
    case 'oledText': {
      const o = dev(a.device);
      return [`${o}.setTextSize(${a.size});`, `${o}.setCursor(${a.x}, ${a.y});`, ...printParts(a.text, o, true)];
    }
    case 'serialPrint': {
      const parts = printParts(a.text, 'Serial', false);
      const last = parts.pop();
      return last ? [...parts, last.replace(/^Serial\.print\(/, 'Serial.println(')] : ['Serial.println();'];
    }
    case 'servoWrite': return [`servo_${a.pin}.write(${value(a.angle)});`];
    case 'tone': return [a.ms > 0 ? `tone(${a.pin}, ${value(a.freq)}, ${a.ms});` : `tone(${a.pin}, ${value(a.freq)});`];
    case 'noTone': return [`noTone(${a.pin});`];
    case 'tftFill': return [`${dev(a.device)}.fillScreen(${c565(a.color)});`];
    case 'tftText': {
      const o = dev(a.device);
      return [`${o}.setTextColor(${c565(a.color)}, ST77XX_BLACK);`, `${o}.setTextSize(${a.size});`, `${o}.setCursor(${a.x}, ${a.y});`, ...printParts(a.text, o, true)];
    }
    case 'tftRect': return [`${dev(a.device)}.${a.fill ? 'fillRect' : 'drawRect'}(${a.x}, ${a.y}, ${a.w}, ${a.h}, ${c565(a.color)});`];
    case 'tftCircle': return [`${dev(a.device)}.${a.fill ? 'fillCircle' : 'drawCircle'}(${a.x}, ${a.y}, ${a.r}, ${c565(a.color)});`];
    case 'tftSprite': {
      const sp = p.sprites?.[a.sprite] ? customSprite(p.sprites[a.sprite]) : builtinSprite(a.sprite);
      if (!sp) return [`// unknown sprite "${a.sprite}"`];
      return a.scale > 1
        ? [`drawScaled(${dev(a.device)}, sprite_${ident(a.sprite)}, ${sp.w}, ${sp.h}, ${a.x}, ${a.y}, ${a.scale});`]
        : [`${dev(a.device)}.drawRGBBitmap(${a.x}, ${a.y}, sprite_${ident(a.sprite)}, ${spriteMask(a.sprite)}, ${sp.w}, ${sp.h});`];
    }
    case 'tftBar': {
      const o = dev(a.device);
      return [
        `${o}.drawRect(${a.x}, ${a.y}, ${a.w}, ${a.h}, ${c565(a.color)});`,
        `${o}.fillRect(${a.x + 1}, ${a.y + 1}, ${a.w - 2}, ${a.h - 2}, ST77XX_BLACK);`,
        `${o}.fillRect(${a.x + 1}, ${a.y + 1}, constrain((int)(${a.w - 2} * (${value(a.value)}) / ${a.max || 1}), 0, ${a.w - 2}), ${a.h - 2}, ${c565(a.color)});`,
      ];
    }
  }
}

/** SSD1306 displays touched by a list of actions: they need display() after drawing. */
const oledsIn = (actions: Action[]) => [...new Set(actions.filter((a) => a.kind === 'oledClear' || a.kind === 'oledText').map((a) => (a as { device: string }).device))];

function ruleBody(r: Rule, p: Program, indent: string): string[] {
  const lines: string[] = [];
  const emit = (acts: Action[], ind: string) => {
    for (const a of acts) for (const l of action(a, p)) lines.push(ind + l);
    for (const d of oledsIn(acts)) lines.push(`${ind}${ident(d)}.display();`);
  };
  if (r.conditions.length) {
    lines.push(`${indent}if (${r.conditions.map(cond).join(' && ')}) {`);
    emit(r.actions, indent + '  ');
    if (r.elseActions.length) { lines.push(`${indent}} else {`); emit(r.elseActions, indent + '  '); }
    lines.push(`${indent}}`);
  } else emit(r.actions, indent);
  return lines;
}

function spriteArrays(p: Program, names: string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    const sp = p.sprites?.[name] ? customSprite(p.sprites[name]) : builtinSprite(name);
    if (!sp) continue;
    const px = sp.px.map((h) => (h ? c565(h) : '0x0000'));
    const mask: number[] = [];
    for (let y = 0; y < sp.h; y++) for (let bx = 0; bx < Math.ceil(sp.w / 8); bx++) {
      let byte = 0;
      for (let k = 0; k < 8; k++) { const x = bx * 8 + k; if (x < sp.w && sp.px[y * sp.w + x]) byte |= 0x80 >> k; }
      mask.push(byte);
    }
    out.push(`// ${sp.w}×${sp.h} sprite "${name}" (RGB565) and its transparency mask`);
    out.push(`const uint16_t sprite_${ident(name)}[] PROGMEM = {`);
    for (let i = 0; i < px.length; i += 16) out.push(`  ${px.slice(i, i + 16).join(', ')},`);
    out.push('};');
    out.push(`const uint8_t ${spriteMask(name)}[] PROGMEM = { ${mask.map((b) => `0x${b.toString(16).padStart(2, '0')}`).join(', ')} };`);
  }
  return out;
}

export function generateSketch(p: Program, title = 'ESP32 Lab project'): string {
  const L: string[] = [];
  const rules = p.rules.filter((r) => r.enabled);
  const allActions = rules.flatMap((r) => [...r.actions, ...r.elseActions]);
  const allValues: Value[] = [];
  for (const r of rules) for (const c of r.conditions) allValues.push(c.left, c.right);
  for (const a of allActions) {
    if (a.kind === 'pwmWrite') allValues.push(a.duty);
    if (a.kind === 'setVar') allValues.push(a.value);
    if (a.kind === 'servoWrite') allValues.push(a.angle);
    if (a.kind === 'tone') allValues.push(a.freq);
    if (a.kind === 'tftBar') allValues.push(a.value);
  }
  const dhts = p.devices.filter((d) => d.kind === 'dht');
  const oleds = p.devices.filter((d) => d.kind === 'ssd1306');
  const bmes = p.devices.filter((d) => d.kind === 'bme280');
  const tfts = p.devices.filter((d) => d.kind === 'tft');
  const servoPins = [...new Set(allActions.filter((a) => a.kind === 'servoWrite').map((a) => (a as { pin: number }).pin))];
  const feeds = [...new Set(allValues.filter((v) => v.kind === 'feed').map((v) => (v as { feed: string }).feed))].filter((f) => FEED_IDS.includes(f));
  const sprites = [...new Set(allActions.filter((a) => a.kind === 'tftSprite').map((a) => (a as { sprite: string }).sprite))];
  const scaled = allActions.some((a) => a.kind === 'tftSprite' && a.scale > 1);
  const used = JSON.stringify(rules);
  const lists = Object.entries(p.lists ?? {}).filter(([name]) => used.includes(name));

  L.push(`// ${title}`);
  L.push('// Generated from the behaviour editor for Arduino-ESP32 core 3.x.');
  L.push('// ESP32 Lab simulates this behaviour; it does not compile or run this code.');
  if (oleds.length || bmes.length) L.push('#include <Wire.h>');
  if (oleds.length || tfts.length) L.push('#include <Adafruit_GFX.h>');
  if (oleds.length) L.push('#include <Adafruit_SSD1306.h>');
  if (tfts.length) L.push('#include <SPI.h>', '#include <Adafruit_ST7735.h>');
  if (bmes.length) L.push('#include <Adafruit_BME280.h>');
  if (dhts.length) L.push('#include <DHT.h>');
  if (servoPins.length) L.push('#include <ESP32Servo.h>');
  L.push('');
  for (const d of dhts) if (d.kind === 'dht') L.push(`DHT ${ident(d.id)}(${d.pin}, ${d.model});`);
  for (const d of oleds) L.push(`Adafruit_SSD1306 ${ident(d.id)}(128, 64, &Wire, -1);`);
  for (const d of bmes) L.push(`Adafruit_BME280 ${ident(d.id)};`);
  for (const d of tfts) if (d.kind === 'tft') L.push(`Adafruit_ST7735 ${ident(d.id)}(${d.cs}, ${d.dc}, ${d.rst});  // CS, DC, RESET; hardware SPI: SCK 18, MOSI 23`);
  for (const pin of servoPins) L.push(`Servo servo_${pin};`);
  for (const [name, lines] of lists) {
    L.push(`const char* ${ident(name)}[] = {`, ...lines.map((l) => `  ${JSON.stringify(l)},`), '};', `const int ${ident(name)}_count = ${lines.length};`);
  }
  L.push(...spriteArrays(p, sprites));
  const vars = new Map<string, number>(p.vars.map((v) => [v.name, v.initial]));
  for (const a of allActions) {
    if (a.kind === 'readDht') for (const n of [a.temp, a.hum]) if (!vars.has(n)) vars.set(n, 0);
    if (a.kind === 'readBme') for (const n of [a.temp, a.hum, a.pres]) if (!vars.has(n)) vars.set(n, 0);
    if (a.kind === 'setVar' && !vars.has(a.name)) vars.set(a.name, 0);
  }
  for (const v of allValues) if (v.kind === 'var' && !vars.has(v.name)) vars.set(v.name, 0);
  for (const [name, init] of vars) L.push(`float ${ident(name)} = ${init};`);
  const timers = rules.filter((r) => r.trigger.kind === 'every');
  const edges = rules.filter((r) => r.trigger.kind === 'pinEdge');
  for (const r of timers) L.push(`unsigned long last_${ident(r.id)} = 0;`);
  const edgePins = [...new Set(edges.map((r) => (r.trigger as { pin: number }).pin))];
  for (const pin of edgePins) L.push(`int prev_${pin} = HIGH;`);
  for (const f of feeds) {
    L.push('', `// ${getFeed(f).label}: ESP32 Lab feeds this from a SIMULATED random walk. On real hardware, fetch`,
      '// a price over Wi-Fi (HTTPClient + a JSON parser) and return it here.',
      `float simulatedPrice_${ident(f)}() { return ${getFeed(f).value(0).toFixed(2)}; }`);
  }
  if (scaled) {
    L.push('', '// draws a bitmap with every pixel enlarged to scale × scale');
    L.push('void drawScaled(Adafruit_ST7735 &t, const uint16_t *bmp, int w, int h, int x0, int y0, int s) {');
    L.push('  for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {', '    uint16_t c = pgm_read_word(&bmp[y * w + x]);', '    if (c) t.fillRect(x0 + x * s, y0 + y * s, s, s, c);', '  }', '}');
  }
  L.push('');

  L.push('void setup() {');
  L.push('  Serial.begin(115200);');
  for (const [pin, mode] of Object.entries(p.pins)) L.push(`  pinMode(${pin}, ${mode});`);
  if (oleds.length || bmes.length) L.push(`  Wire.begin(${p.i2c.sda}, ${p.i2c.scl});  // SDA, SCL`);
  for (const d of dhts) L.push(`  ${ident(d.id)}.begin();`);
  for (const d of bmes) if (d.kind === 'bme280') L.push(`  if (!${ident(d.id)}.begin(0x${d.address.toString(16).toUpperCase()})) Serial.println("Could not find a valid BME280 sensor, check wiring!");`);
  for (const d of oleds) if (d.kind === 'ssd1306') {
    L.push(`  ${ident(d.id)}.begin(SSD1306_SWITCHCAPVCC, 0x${d.address.toString(16).toUpperCase()});`);
    L.push(`  ${ident(d.id)}.cp437(true);`, `  ${ident(d.id)}.setTextColor(SSD1306_WHITE);`, `  ${ident(d.id)}.clearDisplay();`, `  ${ident(d.id)}.display();`);
  }
  for (const d of tfts) L.push(`  ${ident(d.id)}.initR(INITR_BLACKTAB);`, `  ${ident(d.id)}.cp437(true);`, `  ${ident(d.id)}.fillScreen(ST77XX_BLACK);`);
  for (const pin of servoPins) L.push(`  servo_${pin}.attach(${pin});  // 50 Hz, 544–2400 µs`);
  for (const pin of edgePins) L.push(`  prev_${pin} = digitalRead(${pin});`);
  for (const r of rules.filter((x) => x.trigger.kind === 'start')) {
    L.push(`  // ${r.name}`);
    L.push(...ruleBody(r, p, '  '));
  }
  for (const r of timers) if (r.trigger.kind === 'every' && r.trigger.immediate) L.push(`  last_${ident(r.id)} = millis() - ${r.trigger.ms};  // run once right away`);
  L.push('}', '');

  L.push('void loop() {');
  if (timers.length) L.push('  unsigned long now = millis();');
  for (const r of timers) {
    if (r.trigger.kind !== 'every') continue;
    L.push('', `  // ${r.name}`);
    L.push(`  if (now - last_${ident(r.id)} >= ${r.trigger.ms}) {`);
    L.push(`    last_${ident(r.id)} = now;`);
    L.push(...ruleBody(r, p, '    '));
    L.push('  }');
  }
  for (const pin of edgePins) {
    L.push('', `  int cur_${pin} = digitalRead(${pin});`);
    for (const r of edges.filter((x) => (x.trigger as { pin: number }).pin === pin)) {
      const e = (r.trigger as { edge: string }).edge;
      const test = e === 'rising' ? `prev_${pin} == LOW && cur_${pin} == HIGH` : e === 'falling' ? `prev_${pin} == HIGH && cur_${pin} == LOW` : `cur_${pin} != prev_${pin}`;
      L.push(`  // ${r.name}`);
      L.push(`  if (${test}) {`);
      L.push(...ruleBody(r, p, '    '));
      L.push('  }');
    }
    L.push(`  prev_${pin} = cur_${pin};`);
  }
  if (edgePins.length) L.push('  delay(10);  // crude debounce');
  L.push('}');
  return L.join('\n') + '\n';
}
