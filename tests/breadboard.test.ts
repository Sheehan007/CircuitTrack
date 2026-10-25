import { describe, expect, it } from 'vitest';
import { blankProject, type Project } from '../src/sim/project';
import { DOIT_DEVKIT_V1 } from '../src/sim/boards/doitDevkitV1';
import { buildNetlist } from '../src/sim/netlist';
import { act, rule } from '../src/content/templates';
import { codes, run } from './helpers';

const col = (c: number) => (c - 15.5) * 2.54;

/** GPIO23 → hole a5 · resistor c5–c9 · LED (turned) b9/b8 · hole a8 → GND. */
function bbProject(ledRot = 1): Project {
  const p = blankProject('Breadboard blink');
  const by = -60;
  p.parts.push(
    { id: 'bb', type: 'breadboard', label: 'Breadboard 1', x: 0, y: by, rot: 0, params: {} },
    { id: 'r1', type: 'resistor', label: 'R 1', x: col(5) + 5.08, y: by + 8.89, rot: 0, z: 8.5, params: { ohms: 220 } },
    // turned (rot 1) the legs span columns 8 and 9 on row b; unturned they both sit in column 9 (rows a and b)
    ledRot === 1
      ? { id: 'led1', type: 'led', label: 'LED 1', x: col(9) - 1.27, y: by + 11.43, rot: 1, z: 8.5, params: { color: 'red' } }
      : { id: 'led1', type: 'led', label: 'LED 1', x: col(9), y: by + 12.7, rot: 0, z: 8.5, params: { color: 'red' } },
  );
  p.wires.push(
    { id: 'w1', a: { part: 'esp32', term: 'GPIO23' }, b: { part: 'bb', term: 'a5' }, color: '#f00' },
    { id: 'w2', a: { part: 'bb', term: 'a8' }, b: { part: 'esp32', term: 'GND_R' }, color: '#000' },
  );
  p.program.pins = { 23: 'OUTPUT' };
  p.program.rules.push(rule({ name: 'on', trigger: { kind: 'start' }, actions: [act({ kind: 'digitalWrite', pin: 23, value: 'HIGH' })] }));
  return p;
}

describe('breadboard', () => {
  it('plugs legs into holes and joins strips', () => {
    const p = bbProject();
    const nl = buildNetlist(p, DOIT_DEVKIT_V1);
    expect(nl.insertions.map((i) => `${i.part}.${i.term}=${i.hole}`).sort()).toEqual(['led1.A=b9', 'led1.K=b8', 'r1.1=c5', 'r1.2=c9']);
    expect(nl.netOf.get('r1:1')).toBe(nl.netOf.get('esp32:GPIO23'));
    expect(nl.netOf.get('led1:K')).toBe(0);
    expect(nl.netOf.get('bb:j5')).not.toBe(nl.netOf.get('bb:a5')); // the centre channel separates a–e from f–j
  });

  it('lights the LED through the breadboard', () => {
    const e = run(bbProject(), 10);
    expect(e.snapshot().parts.led1.visual.ma as number).toBeCloseTo(4.78, 1);
    expect(codes(e)).not.toContain('part-unwired');
  });

  it('an LED with both legs in one strip is shorted and the check says so', () => {
    const e = run(bbProject(0), 10);
    expect(codes(e)).toContain('same-strip');
    expect(e.snapshot().parts.led1.visual.brightness).toBe(0);
  });
});
