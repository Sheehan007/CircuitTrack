import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { composeScene, screenToGround } from '../figures/scene';
import { filterFor } from '../figures/engine/core.js';
import { store, useApp, toast } from '../app/store';
import * as A from '../app/actions';
import { interact } from '../app/host';
import { getDef } from '../sim/components/registry';
import { BOARD_PART_ID } from '../sim/project';
import { BB } from '../sim/components/breadboard';
import type { TermRef } from '../sim/types';
import { Icon } from './common';
import { enableSound } from '../app/audio';

const WIRE_COLORS = [
  ['#e2483d', 'Red (power)'], ['#2b2724', 'Black (ground)'], ['#f2b632', 'Yellow'], ['#3f8ee8', 'Blue'],
  ['#43c25c', 'Green'], ['#a35fd6', 'Purple'], ['#f08a24', 'Orange'], ['#f4f1ea', 'White'],
] as const;

interface View { cx: number; cy: number; upp: number }
type Drag =
  | { kind: 'part'; id: string; dx: number; dy: number; moved: boolean; sx: number; sy: number }
  | { kind: 'pan'; sx: number; sy: number; cx: number; cy: number }
  | { kind: 'press'; part: string; key: string }
  | null;

const parseTerm = (key: string): TermRef => { const i = key.indexOf(':'); return { part: key.slice(0, i), term: key.slice(i + 1) }; };

export function Stage() {
  const project = useApp((s) => s.project);
  const snap = useApp((s) => s.snap);
  const selection = useApp((s) => s.selection);
  const settings = useApp((s) => s.settings);
  const mode = useApp((s) => s.mode);
  const fitToken = useApp((s) => s.fitToken);
  const wireColor = useApp((s) => s.wireColor);
  const run = useApp((s) => s.run);
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [view, setView] = useState<View>({ cx: 0, cy: 0, upp: 0.15 });
  // default view looks from the D23…3V3 side, where parts sit in the templates
  const [turn, setTurn] = useState(3);
  const [hoverTerm, setHoverTerm] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ from: TermRef; to: [number, number]; sticky: boolean } | null>(null);
  const drag = useRef<Drag>(null);
  const fitted = useRef(-1);
  /** Set once the user pans or zooms; until then the view keeps re-fitting when the bench is resized. */
  const userMoved = useRef(false);
  const yaw = 45 + 90 * turn;
  const build = mode === 'build';

  useLayoutEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSize({ w: Math.max(200, el.clientWidth), h: Math.max(200, el.clientHeight) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scene = useMemo(() => composeScene({
    project, snap, yaw, unitsPerPx: view.upp, selection, hoverTerm,
    draft: draft ? { from: draft.from, to: draft.to } : null,
    labels: settings.labels, wobble: settings.wobble,
  }), [project, snap, yaw, view.upp, selection, hoverTerm, draft, settings.labels, settings.wobble]);

  const fit = () => {
    const [x0, y0, x1, y1] = scene.bounds;
    const upp = Math.max((x1 - x0) / Math.max(100, size.w - 120), (y1 - y0) / Math.max(100, size.h - 120), 0.03);
    setView({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, upp });
    userMoved.current = false;
  };
  useEffect(() => { if (fitted.current !== fitToken && size.w > 200) { fitted.current = fitToken; fit(); } }, [fitToken, size.w, size.h, scene.bounds]);
  useEffect(() => { if (!userMoved.current && size.w > 200) fit(); }, [size.w, size.h]);
  useEffect(() => { fit(); }, [turn]);

  const vb = { x: view.cx - (size.w * view.upp) / 2, y: view.cy - (size.h * view.upp) / 2, w: size.w * view.upp, h: size.h * view.upp };
  const toScene = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = svg.current!.getBoundingClientRect();
    return [vb.x + (e.clientX - r.left) * view.upp, vb.y + (e.clientY - r.top) * view.upp];
  };
  const nearestTerm = (X: number, Y: number, radiusPx = 14) => {
    let best: string | null = null, bd = radiusPx * view.upp;
    for (const [k, [x, y]] of scene.terminals) { const d = Math.hypot(x - X, y - Y); if (d < bd) { bd = d; best = k; } }
    return best;
  };
  const partPos = (id: string) => id === BOARD_PART_ID ? project.boardPlacement : project.parts.find((p) => p.id === id)!;

  const finishWire = (target: string | null) => {
    if (!draft) return;
    if (target && target !== `${draft.from.part}:${draft.from.term}`) {
      const id = A.addWire(draft.from, parseTerm(target));
      if (id) store.set({ selection: { kind: 'wire', id } });
    }
    setDraft(null);
  };

  // capture can fail for synthetic or already-released pointers; dragging still works without it
  const capture = (id: number) => { try { svg.current?.setPointerCapture(id); } catch { /* ignore */ } };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const t = e.target as Element;
    const [X, Y] = toScene(e);
    svg.current?.focus({ preventScroll: true });
    const termEl = t.closest('[data-act="term"]') as SVGElement | null;
    const pressEl = t.closest('[data-act="press"]') as SVGElement | null;
    const wireEl = t.closest('[data-wire-id]') as SVGElement | null;
    const partEl = t.closest('[data-part-id]') as SVGElement | null;
    if (draft?.sticky) {
      finishWire(termEl ? `${termEl.dataset.part}:${termEl.dataset.term}` : nearestTerm(X, Y));
      return;
    }
    if (pressEl) {
      const part = pressEl.dataset.part!, target = pressEl.dataset.target!;
      const key = part === BOARD_PART_ID ? (target === 'EN' ? 'en' : 'boot') : target;
      interact(part, key, true);
      drag.current = { kind: 'press', part, key };
      capture(e.pointerId);
      return;
    }
    if (termEl && build) {
      setDraft({ from: { part: termEl.dataset.part!, term: termEl.dataset.term! }, to: [X, Y], sticky: false });
      capture(e.pointerId);
      return;
    }
    if (wireEl) { store.set({ selection: { kind: 'wire', id: wireEl.dataset.wireId! }, rightTab: 'inspector' }); return; }
    if (partEl) {
      const id = partEl.dataset.partId!;
      store.set({ selection: { kind: 'part', id }, rightTab: 'inspector' });
      if (build) {
        const [gx, gy] = screenToGround(X, Y, yaw);
        const pos = partPos(id);
        drag.current = { kind: 'part', id, dx: pos.x - gx, dy: pos.y - gy, moved: false, sx: e.clientX, sy: e.clientY };
        capture(e.pointerId);
      }
      return;
    }
    store.set({ selection: null });
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: view.cx, cy: view.cy };
    capture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    const [X, Y] = toScene(e);
    const d = drag.current;
    if (draft) {
      setDraft({ ...draft, to: [X, Y] });
      setHoverTerm(nearestTerm(X, Y));
      return;
    }
    if (d?.kind === 'part') {
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
      if (!d.moved) { d.moved = true; A.beginDrag(); }
      const [gx, gy] = screenToGround(X, Y, yaw);
      A.movePart(d.id, gx + d.dx, gy + d.dy, false);
      return;
    }
    if (d?.kind === 'pan') {
      userMoved.current = true;
      setView((v) => ({ ...v, cx: d.cx - (e.clientX - d.sx) * v.upp, cy: d.cy - (e.clientY - d.sy) * v.upp }));
      return;
    }
    const termEl = (e.target as Element).closest?.('[data-act="term"]') as SVGElement | null;
    const k = termEl ? `${termEl.dataset.part}:${termEl.dataset.term}` : null;
    if (k !== hoverTerm) setHoverTerm(k);
  };

  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === 'press') { interact(d.part, d.key, false); return; }
    if (draft && !draft.sticky) {
      const [X, Y] = toScene(e);
      const target = nearestTerm(X, Y);
      const fromKey = `${draft.from.part}:${draft.from.term}`;
      // released on the starting pin: switch to click-click wiring
      if (!target || target === fromKey) {
        if (target === fromKey) { setDraft({ ...draft, sticky: true }); toast('Now click the other end of the wire (Esc cancels).'); }
        else setDraft(null);
        return;
      }
      finishWire(target);
    }
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    userMoved.current = true;
    const [X, Y] = toScene(e);
    const k = Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * 0.0025);
    setView((v) => {
      const upp = Math.max(0.012, Math.min(1.2, v.upp * k));
      return { upp, cx: X - (X - v.cx) * (upp / v.upp), cy: Y - (Y - v.cy) * (upp / v.upp) };
    });
  };
  useEffect(() => {
    const el = svg.current!;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const zoom = (k: number) => { userMoved.current = true; setView((v) => ({ ...v, upp: Math.max(0.012, Math.min(1.2, v.upp * k)) })); };

  const onKeyDown = (e: KeyboardEvent) => {
    const sel = store.get().selection;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') { setDraft(null); store.set({ selection: null }); return; }
    if (e.key === '+' || e.key === '=') { zoom(1 / 1.25); e.preventDefault(); return; }
    if (e.key === '-') { zoom(1.25); e.preventDefault(); return; }
    if (e.key === '[' || e.key === ']') { setTurn((t) => (t + (e.key === ']' ? 1 : 3)) % 4); return; }
    if (!sel) return;
    if (sel.kind === 'part') {
      const part = sel.id === BOARD_PART_ID ? null : project.parts.find((p) => p.id === sel.id);
      if (e.key === ' ' && part && getDef(part.type).interactions?.length) {
        e.preventDefault();
        if (!e.repeat) interact(part.id, getDef(part.type).interactions![0].key, true);
        return;
      }
      if (!build) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { A.deletePart(sel.id); e.preventDefault(); return; }
      if (e.key.toLowerCase() === 'r' && !mod) { A.rotatePart(sel.id); return; }
      if (e.key.toLowerCase() === 'd' && mod) { e.preventDefault(); A.duplicatePart(sel.id); return; }
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (step) {
        e.preventDefault();
        const pos = partPos(sel.id);
        A.movePart(sel.id, pos.x + step[0] * 2.54, pos.y + step[1] * 2.54);
      }
    } else if (build && (e.key === 'Delete' || e.key === 'Backspace')) { A.deleteWire(sel.id); e.preventDefault(); }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    const sel = store.get().selection;
    if (e.key === ' ' && sel?.kind === 'part') {
      const part = project.parts.find((p) => p.id === sel.id);
      const ia = part && getDef(part.type).interactions?.[0];
      if (part && ia?.kind === 'momentary') interact(part.id, ia.key, false);
    }
  };

  const onDrop = (e: DragEvent) => {
    const type = e.dataTransfer?.getData('text/x-esp32lab-part');
    if (!type || !build) return;
    e.preventDefault();
    const [X, Y] = toScene(e);
    // dropping a leaded part onto a breadboard: aim at the board's top surface, not the bench under it
    let [gx, gy] = screenToGround(X, Y, yaw);
    if (getDef(type).insertable) {
      const [tx, ty] = screenToGround(X, Y, yaw, BB.top);
      const onBoard = project.parts.some((p) => p.type === 'breadboard' && Math.abs(tx - p.x) < (p.rot % 2 ? BB.halfY : BB.halfX) && Math.abs(ty - p.y) < (p.rot % 2 ? BB.halfX : BB.halfY));
      if (onBoard) [gx, gy] = [tx, ty];
    }
    A.addPart(type, gx, gy);
  };

  const filter = useMemo(() => filterFor(view.upp * 1.25), [Math.round(view.upp * 400)]);
  const selPart = selection?.kind === 'part' ? selection.id : null;
  const altList = useMemo(() => project.parts.map((p) => `${p.label}: ${getDef(p.type).alt({ ...getDef(p.type).defaults, ...p.params })}`), [project]);

  return (
    <div class={`stage${draft ? ' wiring' : ''}`} ref={wrap} onDragOver={(e) => { if (build) e.preventDefault(); }} onDrop={onDrop}>
      <svg
        ref={svg}
        class="bench"
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        tabIndex={0}
        role="application"
        aria-label={`Workbench: ESP32 DOIT DevKit V1 with ${project.parts.length} parts and ${project.wires.length} wires. ${build ? 'Drag parts to move them; drag from a pin to another pin to wire them. Arrow keys move the selected part, R rotates, Delete removes, Space presses a button.' : 'Press the button parts to interact.'}`}
        onPointerDown={onPointerDown as any}
        onPointerMove={onPointerMove as any}
        onPointerUp={onPointerUp as any}
        onPointerCancel={() => { drag.current = null; }}
        onPointerLeave={() => !draft && setHoverTerm(null)}
        onKeyDown={onKeyDown as any}
        onKeyUp={onKeyUp as any}
      >
        <defs dangerouslySetInnerHTML={{ __html: filter }} />
        <g dangerouslySetInnerHTML={{ __html: scene.shadows }} />
        <g dangerouslySetInnerHTML={{ __html: scene.parts }} />
        <g dangerouslySetInnerHTML={{ __html: scene.wires }} />
        <g dangerouslySetInnerHTML={{ __html: scene.labels }} />
      </svg>
      <ul class="sr-only" aria-label="Parts on the bench">{altList.map((t) => <li key={t}>{t}</li>)}</ul>
      <div class="stage-tools" role="toolbar" aria-label="View">
        <button class="icon-btn" title="Turn view left ( [ )" aria-label="Turn view left" onClick={() => setTurn((t) => (t + 3) % 4)}><Icon name="rotl" /></button>
        <button class="icon-btn" title="Turn view right ( ] )" aria-label="Turn view right" onClick={() => setTurn((t) => (t + 1) % 4)}><Icon name="rotr" /></button>
        <span class="sep" />
        <button class="icon-btn" title="Zoom out (−)" aria-label="Zoom out" onClick={() => zoom(1.25)}><Icon name="minus" /></button>
        <button class="icon-btn" title="Zoom in (+)" aria-label="Zoom in" onClick={() => zoom(1 / 1.25)}><Icon name="plus" /></button>
        <button class="icon-btn" title="Fit everything" aria-label="Fit everything in view" onClick={fit}><Icon name="fit" /></button>
        <span class="sep" />
        <button class={`icon-btn${settings.sound ? ' on' : ''}`} title={settings.sound ? 'Sound on (buzzers play while running)' : 'Sound off'} aria-label={settings.sound ? 'Turn sound off' : 'Turn sound on'} aria-pressed={settings.sound}
          onClick={() => { const on = !settings.sound; if (enableSound(on)) store.set({ settings: { ...settings, sound: on } }); else toast('This browser has no WebAudio.'); }}><Icon name={settings.sound ? 'sound' : 'mute'} /></button>
        <span class="sep" />
        <label class="mini-select" title="Pin name tags">
          <span>Pin tags</span>
          <select value={settings.labels} onChange={(e) => { const labels = (e.target as HTMLSelectElement).value as 'none' | 'wired' | 'all'; store.set({ settings: { ...settings, labels } }); }}>
            <option value="wired">wired</option><option value="all">all</option><option value="none">off</option>
          </select>
        </label>
      </div>
      {build && (
        <div class="stage-tools edit" role="toolbar" aria-label="Editing">
          <span class="tool-label">New wires</span>
          {WIRE_COLORS.map(([c, name]) => (
            <button key={c} class={`swatch${wireColor === c ? ' on' : ''}`} style={{ background: c }} title={name} aria-label={`Wire colour ${name}`} aria-pressed={wireColor === c}
              onClick={() => { store.set({ wireColor: c }); if (selection?.kind === 'wire') A.setWireColor(selection.id, c); }} />
          ))}
          {selPart && selPart !== BOARD_PART_ID && <>
            <span class="sep" />
            <button class="icon-btn" title="Rotate part (R)" aria-label="Rotate selected part" onClick={() => A.rotatePart(selPart)}><Icon name="rotr" /></button>
            <button class="icon-btn" title="Duplicate (Ctrl+D)" aria-label="Duplicate selected part" onClick={() => A.duplicatePart(selPart)}><Icon name="copy" /></button>
            <button class="icon-btn danger" title="Delete (Del)" aria-label="Delete selected part" onClick={() => A.deletePart(selPart)}><Icon name="trash" /></button>
          </>}
          {selection?.kind === 'wire' && <>
            <span class="sep" />
            <button class="icon-btn danger" title="Delete wire (Del)" aria-label="Delete selected wire" onClick={() => A.deleteWire(selection.id)}><Icon name="trash" /></button>
          </>}
        </div>
      )}
      {draft && <div class="stage-hint" role="status">{draft.sticky ? 'Click the other end of the wire · Esc cancels' : 'Release on another pin to connect'}</div>}
      {!draft && build && project.parts.length === 0 && <div class="stage-hint" role="status">Drag parts from the catalogue onto the bench, then drag from pin to pin to wire them.</div>}
      {run === 'running' && <div class="live-dot" aria-hidden="true" />}
    </div>
  );
}
