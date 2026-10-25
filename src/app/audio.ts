// Buzzer sound through WebAudio. Off by default; the first toggle (a user gesture) creates the AudioContext.
// Only plays while the simulation is running, at real pitch (the simulation speed does not change the pitch).
import { store } from './store';

let ctx: AudioContext | null = null;
const voices = new Map<string, { osc: OscillatorNode; gain: GainNode }>();

function stopAll() {
  for (const [id, v] of voices) { v.gain.gain.setTargetAtTime(0, ctx!.currentTime, 0.01); v.osc.stop(ctx!.currentTime + 0.05); voices.delete(id); }
}

export function enableSound(on: boolean) {
  if (on && !ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
  }
  if (on) ctx?.resume();
  else if (ctx) stopAll();
  return true;
}

export function startAudioSync() {
  store.subscribe(() => {
    const s = store.get();
    if (!ctx) return;
    const want = new Map<string, number>();
    if (s.settings.sound && s.run === 'running' && s.snap) {
      for (const [id, p] of Object.entries(s.snap.parts)) {
        const v = p.visual as { sounding?: boolean; hz?: number };
        if (v.sounding && v.hz) want.set(id, v.hz);
      }
    }
    for (const [id, v] of voices) if (!want.has(id)) { v.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.01); v.osc.stop(ctx.currentTime + 0.05); voices.delete(id); }
    for (const [id, hz] of want) {
      const v = voices.get(id);
      if (v) { v.osc.frequency.setTargetAtTime(hz, ctx.currentTime, 0.005); continue; }
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = hz;
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(0.035, ctx.currentTime, 0.01);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      voices.set(id, { osc, gain });
    }
  });
}
