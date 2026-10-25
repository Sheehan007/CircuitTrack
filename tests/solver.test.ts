import { describe, expect, it } from 'vitest';
import { drivenNodes, solve, type Element } from '../src/sim/solver';

describe('solver', () => {
  it('drives an LED through a resistor from a 3.3 V output', () => {
    // node1 = pin, node2 = between resistor and LED
    const els: Element[] = [
      { kind: 'V', id: 'pin', p: 1, n: 0, volts: 3.3, ohms: 40 },
      { kind: 'R', id: 'r', a: 1, b: 2, ohms: 220 },
      { kind: 'D', id: 'led', a: 2, b: 0, vf: 2.0, rs: 12 },
    ];
    const s = solve(3, els);
    const ma = s.current.get('led')! * 1000;
    expect(s.converged).toBe(true);
    expect(ma).toBeCloseTo(((3.3 - 2.0) / (40 + 220 + 12)) * 1000, 2);
    expect(s.diodeOn.has('led')).toBe(true);
  });

  it('keeps a reversed LED dark', () => {
    const els: Element[] = [
      { kind: 'V', id: 'pin', p: 1, n: 0, volts: 3.3, ohms: 40 },
      { kind: 'R', id: 'r', a: 1, b: 2, ohms: 220 },
      { kind: 'D', id: 'led', a: 0, b: 2, vf: 2.0, rs: 12 },
    ];
    const s = solve(3, els);
    expect(s.current.get('led')).toBe(0);
  });

  it('a blue LED barely conducts at 3.3 V with 220 Ω', () => {
    const s = solve(3, [
      { kind: 'V', id: 'pin', p: 1, n: 0, volts: 3.3, ohms: 40 },
      { kind: 'R', id: 'r', a: 1, b: 2, ohms: 220 },
      { kind: 'D', id: 'led', a: 2, b: 0, vf: 3.0, rs: 12 },
    ]);
    expect(s.current.get('led')! * 1000).toBeLessThan(1.5);
  });

  it('pull-up and switch: released reads 3.3 V, pressed reads ~0 V', () => {
    const base = (closed: boolean): Element[] => [
      { kind: 'V', id: '3v3', p: 2, n: 0, volts: 3.3, ohms: 0.2 },
      { kind: 'R', id: 'pu', a: 1, b: 2, ohms: 45_000 },
      { kind: 'SW', id: 'btn', a: 1, b: 0, closed },
    ];
    expect(solve(3, base(false)).v[1]).toBeCloseTo(3.3, 2);
    expect(solve(3, base(true)).v[1]).toBeLessThan(0.01);
  });

  it('finds floating nodes', () => {
    const els: Element[] = [
      { kind: 'V', id: 's', p: 1, n: 0, volts: 3.3, ohms: 1 },
      { kind: 'R', id: 'r', a: 1, b: 2, ohms: 1000 },
      { kind: 'R', id: 'island', a: 3, b: 4, ohms: 1000 },
    ];
    const d = drivenNodes(5, els);
    expect([...d].sort()).toEqual([0, 1, 2]);
  });
});
