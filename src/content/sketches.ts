// Arduino sketches that really run (compiled by src/sim/firmware), and demo projects that pair each one with a circuit.
// The sketches only use the supported subset (see the README); every demo is exercised end to end in
// tests/firmware-demos.test.ts before it is listed here.
import { blankSketchProject, type Project } from '../sim/project';
import type { PartInstance, Wire } from '../sim/types';
import { registerTemplates, WIRE_COLORS as C } from './templates';

export const BLINK = `// Blink: an LED on GPIO23 through a 220 Ω resistor, on for 1 s, off for 1 s.
const int LED_PIN = 23;

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  Serial.println("Blink started");
}

void loop() {
  digitalWrite(LED_PIN, HIGH);   // 3.3 V on the pin: current flows through the resistor and the LED
  Serial.println("LED on");
  delay(1000);
  digitalWrite(LED_PIN, LOW);    // 0 V: no current, the LED is dark
  Serial.println("LED off");
  delay(1000);
}
`;

export const BUTTON = `// Button → LED: the button connects GPIO4 to GND; the internal pull-up keeps it HIGH otherwise.
const int BUTTON_PIN = 4;
const int LED_PIN = 23;

int lastState = HIGH;

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  int state = digitalRead(BUTTON_PIN);        // LOW while the button is pressed
  digitalWrite(LED_PIN, state == LOW ? HIGH : LOW);
  if (state != lastState) {
    Serial.println(state == LOW ? "pressed" : "released");
    lastState = state;
  }
  delay(10);                                  // also a simple debounce
}
`;

export const PWM_DIMMER = `// PWM dimmer: the knob on GPIO34 sets the LED brightness on GPIO23 (LEDC PWM, 5 kHz, 8 bits).
const int POT_PIN = 34;
const int LED_PIN = 23;

void setup() {
  Serial.begin(115200);
  ledcAttach(LED_PIN, 5000, 8);   // Arduino-ESP32 3.x; on 2.x: ledcSetup(0, 5000, 8); ledcAttachPin(LED_PIN, 0);
}

void loop() {
  int raw = analogRead(POT_PIN);            // 0…4095
  int duty = map(raw, 0, 4095, 0, 255);     // 0…255 for 8-bit PWM
  ledcWrite(LED_PIN, duty);
  Serial.printf("knob %4d -> duty %3d (%d%%)\\n", raw, duty, duty * 100 / 255);
  delay(200);
}
`;

export const PWM_FADE = `// PWM fade: the LED on GPIO23 breathes up and down using analogWrite().
const int LED_PIN = 23;

void setup() {
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  for (int duty = 0; duty <= 255; duty += 5) {
    analogWrite(LED_PIN, duty);
    delay(20);
  }
  for (int duty = 255; duty >= 0; duty -= 5) {
    analogWrite(LED_PIN, duty);
    delay(20);
  }
}
`;

export const MELODY = `// Melody on a passive buzzer (GPIO25 → buzzer + , buzzer − → GND).
#define NOTE_C4 262
#define NOTE_D4 294
#define NOTE_E4 330
#define NOTE_F4 349
#define NOTE_G4 392
#define NOTE_A4 440

const int BUZZER_PIN = 25;

int melody[] = { NOTE_C4, NOTE_C4, NOTE_G4, NOTE_G4, NOTE_A4, NOTE_A4, NOTE_G4,
                 NOTE_F4, NOTE_F4, NOTE_E4, NOTE_E4, NOTE_D4, NOTE_D4, NOTE_C4 };
int beats[]  = { 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2 };
const int NOTES = sizeof(melody) / sizeof(melody[0]);

void setup() {
  Serial.begin(115200);
  Serial.println("Twinkle, twinkle…");
}

void loop() {
  for (int i = 0; i < NOTES; i++) {
    int ms = beats[i] * 300;
    Serial.print("note ");
    Serial.print(melody[i]);
    Serial.println(" Hz");
    tone(BUZZER_PIN, melody[i], ms * 9 / 10);   // a short gap between notes
    delay(ms);
  }
  noTone(BUZZER_PIN);
  delay(1500);
}
`;

export const SERVO = `// Servo controller: the knob on GPIO34 sets the angle of an SG90 on GPIO18 (powered from VIN, 5 V).
#include <ESP32Servo.h>

Servo arm;
const int SERVO_PIN = 18;
const int POT_PIN = 34;
int lastAngle = -1;

void setup() {
  Serial.begin(115200);
  arm.setPeriodHertz(50);       // standard 50 Hz servo pulses
  arm.attach(SERVO_PIN);        // 544–2400 µs for 0–180°
}

void loop() {
  int angle = map(analogRead(POT_PIN), 0, 4095, 0, 180);
  if (abs(angle - lastAngle) >= 2) {   // ignore tiny changes so the servo doesn't jitter
    arm.write(angle);
    Serial.printf("angle %d\\n", angle);
    lastAngle = angle;
  }
  delay(20);
}
`;

export const WEATHER = `// Weather station: a BME280 (I²C 0x76) measures, an SSD1306 OLED (0x3C) shows it. SDA = GPIO21, SCL = GPIO22.
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_BME280.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);
Adafruit_BME280 bme;

void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("SSD1306 allocation failed");
    for (;;) delay(1000);
  }
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  if (!bme.begin(0x76)) {
    Serial.println("Could not find a valid BME280 sensor, check wiring!");
    display.setCursor(0, 0);
    display.println("BME280 not found");
    display.display();
    for (;;) delay(1000);
  }
}

void loop() {
  float t = bme.readTemperature();
  float h = bme.readHumidity();
  float p = bme.readPressure() / 100.0F;   // Pa → hPa
  Serial.printf("%.1f C  %.0f %%  %.1f hPa\\n", t, h, p);

  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("Weather station");
  display.drawFastHLine(0, 10, 128, SSD1306_WHITE);
  display.setTextSize(2);
  display.setCursor(0, 16);
  display.print(t, 1);
  display.print((char)247);                // the ° sign in the GFX font
  display.println("C");
  display.setTextSize(1);
  display.setCursor(0, 40);
  display.print("Humidity: ");
  display.print(h, 0);
  display.println(" %");
  display.setCursor(0, 52);
  display.print("Pressure: ");
  display.print(p, 0);
  display.println(" hPa");
  display.display();
  delay(2000);
}
`;

export const DHT_SENSOR = `// Sensor: a DHT22 on GPIO4 printed to the Serial monitor every 2 seconds.
#include <DHT.h>

DHT dht(4, DHT22);

void setup() {
  Serial.begin(115200);
  dht.begin();
}

void loop() {
  delay(2000);                      // the DHT22 measures at most every 2 s
  float h = dht.readHumidity();
  float t = dht.readTemperature();
  if (isnan(h) || isnan(t)) {
    Serial.println("Failed to read from DHT sensor!");
    return;
  }
  Serial.print("Temperature: ");
  Serial.print(t, 1);
  Serial.print(" °C  Humidity: ");
  Serial.print(h, 0);
  Serial.println(" %");
}
`;

export const BUTTON_INTERRUPT = `// Interrupt counter: every press of the button on GPIO4 runs onPress() and toggles the LED on GPIO23.
const int BUTTON_PIN = 4;
const int LED_PIN = 23;

volatile int presses = 0;
volatile bool changed = false;

void onPress() {
  presses++;
  changed = true;
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(BUTTON_PIN), onPress, FALLING);
}

void loop() {
  if (changed) {
    changed = false;
    digitalWrite(LED_PIN, presses % 2);
    Serial.print("presses: ");
    Serial.println(presses);
  }
  delay(5);
}
`;

/** Sketches offered in the editor's Examples menu (they replace the code, never the circuit). */
export const SKETCH_EXAMPLES: { id: string; name: string; summary: string; source: string }[] = [
  { id: 'blink', name: 'Blink', summary: 'LED on GPIO23 via 220 Ω: 1 s on, 1 s off.', source: BLINK },
  { id: 'button', name: 'Button', summary: 'Button on GPIO4 (to GND, INPUT_PULLUP) lights the LED on GPIO23.', source: BUTTON },
  { id: 'interrupt', name: 'Button interrupt', summary: 'attachInterrupt on GPIO4 counts presses and toggles GPIO23.', source: BUTTON_INTERRUPT },
  { id: 'pwm', name: 'PWM dimmer', summary: 'Knob on GPIO34 → LEDC PWM brightness on GPIO23.', source: PWM_DIMMER },
  { id: 'fade', name: 'PWM fade', summary: 'analogWrite() breathing LED on GPIO23.', source: PWM_FADE },
  { id: 'buzzer', name: 'Buzzer melody', summary: 'tone() on a passive buzzer at GPIO25.', source: MELODY },
  { id: 'servo', name: 'Servo', summary: 'Knob on GPIO34 → SG90 angle on GPIO18 (ESP32Servo).', source: SERVO },
  { id: 'sensor', name: 'Sensor (DHT22)', summary: 'Temperature and humidity on GPIO4 to the Serial monitor.', source: DHT_SENSOR },
  { id: 'weather', name: 'Weather station', summary: 'BME280 + SSD1306 OLED over I²C (GPIO21/22).', source: WEATHER },
];

/* ---------------- demo projects: circuit + sketch ---------------- */

const B = 'esp32';
let n = 0;
const part = (id: string, type: string, label: string, x: number, y: number, rot: number, params: Record<string, unknown> = {}): PartInstance => ({ id, type, label, x, y, rot, params });
const w = (a: string, b: string, color: string): Wire => {
  const [ap, at] = a.split('.'), [bp, bt] = b.split('.');
  return { id: `s${++n}`, a: { part: ap, term: at }, b: { part: bp, term: bt }, color };
};

function demo(name: string, origin: string, description: string, source: string, parts: PartInstance[], wires: Wire[]): Project {
  const p = blankSketchProject(name, source);
  p.origin = origin;
  p.description = description;
  p.parts = parts;
  p.wires = wires;
  return p;
}

const ledOn23 = (color = 'red') => ({
  parts: [part('r1', 'resistor', 'R 1', -20, -34, 0, { ohms: 220 }), part('led1', 'led', 'LED 1', -9, -40, 0, { color })],
  wires: [w(`${B}.GPIO23`, 'r1.1', C.data), w('r1.2', 'led1.A', C.other), w('led1.K', `${B}.GND_R`, C.ground)],
});

export const blinkDemo = () => {
  const l = ledOn23();
  return demo('Blink (code)', 'code-blink', 'The classic first sketch: GPIO23 → 220 Ω → LED → GND, toggled every second by real code.', BLINK, l.parts, l.wires);
};

export const buttonDemo = () => {
  const l = ledOn23('green');
  return demo('Button → LED (code)', 'code-button', 'digitalRead on GPIO4 (INPUT_PULLUP, button to GND) drives the LED on GPIO23. Hold the button on the bench.', BUTTON,
    [part('btn1', 'button', 'Button 1', 3, -36, 0, { cap: 'red' }), ...l.parts],
    [w('btn1.1a', `${B}.GPIO4`, C.signal), w('btn1.2b', `${B}.GND_R`, C.ground), ...l.wires]);
};

export const dimmerDemo = () => {
  const l = ledOn23('yellow');
  return demo('PWM dimmer (code)', 'code-dimmer', 'Turn the knob (inspector → Knob position): analogRead on GPIO34 sets the LEDC PWM duty on GPIO23.', PWM_DIMMER,
    [part('pot1', 'pot', 'Knob 1', 30, -40, 0, { position: 50 }), ...l.parts],
    [w('pot1.A', `${B}.GND_R`, C.ground), w('pot1.B', `${B}.3V3`, C.power), w('pot1.W', `${B}.GPIO34`, C.other), ...l.wires]);
};

export const melodyDemo = () => demo('Buzzer melody (code)', 'code-melody', 'tone() plays a tune on a passive buzzer on GPIO25. Unmute the sound in the top bar to hear it.', MELODY,
  [part('pz1', 'buzzer-passive', 'Piezo 1', 28, -36, 0)],
  [w('pz1.P', `${B}.GPIO25`, C.other), w('pz1.N', `${B}.GND_R`, C.ground)]);

export const servoDemo = () => demo('Servo controller (code)', 'code-servo', 'The knob on GPIO34 sets the angle of an SG90 on GPIO18 through ESP32Servo. The servo runs from VIN (5 V).', SERVO,
  [part('sv1', 'servo', 'Servo 1', 10, -48, 3, { horn: 'arm' }), part('pot1', 'pot', 'Knob 1', -26, -40, 0, { position: 25 })],
  [w('sv1.VCC', `${B}.VIN`, C.power), w('sv1.GND', `${B}.GND_R`, C.ground), w('sv1.SIG', `${B}.GPIO18`, C.signal),
    w('pot1.A', `${B}.GND_L`, C.ground), w('pot1.B', `${B}.3V3`, C.power), w('pot1.W', `${B}.GPIO34`, C.other)]);

export const weatherDemo = () => demo('Weather station (code)', 'code-weather', 'A BME280 and an SSD1306 OLED share the I²C bus (SDA GPIO21, SCL GPIO22). Change the air in the BME280 inspector.', WEATHER,
  [part('bme1', 'bme280', 'BME280 1', 14, -40, 3), part('oled1', 'ssd1306', 'OLED 1', -22, -46, 3)],
  [w('bme1.VCC', `${B}.3V3`, C.power), w('bme1.GND', `${B}.GND_R`, C.ground), w('bme1.SCL', `${B}.GPIO22`, C.scl), w('bme1.SDA', `${B}.GPIO21`, C.sda),
    w('oled1.VCC', `${B}.3V3`, C.power), w('oled1.GND', `${B}.GND_R`, C.ground), w('oled1.SCL', `${B}.GPIO22`, C.scl), w('oled1.SDA', `${B}.GPIO21`, C.sda)]);

export const CODE_DEMOS = [
  { id: 'code-blink', name: 'Blink (code)', summary: 'Real Arduino code: GPIO23 → resistor → LED, toggled every second.', parts: ['LED', '220 Ω'], build: blinkDemo, code: true },
  { id: 'code-button', name: 'Button → LED (code)', summary: 'digitalRead with INPUT_PULLUP drives an LED.', parts: ['Button', 'LED', '220 Ω'], build: buttonDemo, code: true },
  { id: 'code-dimmer', name: 'PWM dimmer (code)', summary: 'analogRead → ledcWrite: a knob sets LED brightness.', parts: ['Knob', 'LED', '220 Ω'], build: dimmerDemo, code: true },
  { id: 'code-melody', name: 'Buzzer melody (code)', summary: 'tone() plays a tune on a passive buzzer.', parts: ['Passive buzzer'], build: melodyDemo, code: true },
  { id: 'code-servo', name: 'Servo controller (code)', summary: 'A knob sets an SG90 angle with ESP32Servo.', parts: ['SG90 servo', 'Knob'], build: servoDemo, code: true },
  { id: 'code-weather', name: 'Weather station (code)', summary: 'BME280 readings on an SSD1306 OLED with Adafruit libraries.', parts: ['BME280', 'SSD1306 OLED'], build: weatherDemo, code: true },
];

registerTemplates(CODE_DEMOS);
