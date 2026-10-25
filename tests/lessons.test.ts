import { describe, expect, it } from 'vitest';
import { blinkLesson, buttonLesson, LESSONS, type Lesson } from '../src/content/lessons';
import { Engine } from '../src/sim/engine';

const ctx = (e: Engine, values: Record<string, any>, startValues = values) => ({ snap: e.snapshot(), values, history: e.history, startValues });
const check = (l: Lesson, i: number, c: ReturnType<typeof ctx>) => l.steps[i].check?.(c) ?? true;

describe('lesson step checks follow the simulation', () => {
  it('blink: run, watch, change timing, change resistor', () => {
    const v = { ...blinkLesson.defaults };
    const e = new Engine(blinkLesson.build(v));
    expect(check(blinkLesson, 1, ctx(e, v))).toBe(false);
    e.start();
    expect(check(blinkLesson, 1, ctx(e, v))).toBe(true);
    e.advance(1200);
    expect(check(blinkLesson, 2, ctx(e, v))).toBe(false);
    e.advance(2000);
    expect(check(blinkLesson, 2, ctx(e, v))).toBe(true);
    expect(check(blinkLesson, 3, ctx(e, { ...v, delay: 250 }, v))).toBe(true);
    expect(check(blinkLesson, 4, ctx(e, { ...v, ohms: 1000 }))).toBe(true);
  });

  it('button: hold lights the LED, toggle needs two presses', () => {
    let v: Record<string, any> = { mode: 'hold' };
    let e = new Engine(buttonLesson.build(v));
    e.start();
    e.advance(10);
    expect(check(buttonLesson, 2, ctx(e, v))).toBe(false);
    e.interact('btn1', 'pressed', true);
    e.advance(5);
    expect(check(buttonLesson, 2, ctx(e, v))).toBe(true);
    v = { mode: 'toggle' };
    e = new Engine(buttonLesson.build(v));
    e.start();
    e.advance(10);
    const press = () => { e.interact('btn1', 'pressed', true); e.advance(30); e.interact('btn1', 'pressed', false); e.advance(30); };
    press();
    expect(check(buttonLesson, 4, ctx(e, v))).toBe(false);
    press();
    expect(check(buttonLesson, 4, ctx(e, v))).toBe(true);
  });

  it('every lesson builds an error-free project whose code matches its parameters', () => {
    for (const l of LESSONS) {
      for (const p of l.params) for (const o of p.options) {
        const v = { ...l.defaults, [p.key]: o.value };
        const e = new Engine(l.build(v));
        e.start();
        e.advance(100);
        expect(e.snapshot().issues.filter((i) => i.severity === 'error')).toEqual([]);
        expect(l.code(v).length).toBeGreaterThan(50);
      }
    }
  });
});
