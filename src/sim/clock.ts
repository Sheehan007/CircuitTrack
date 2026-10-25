/*
  Virtual clock: simulated milliseconds since power-on, plus an ordered event queue.
  Time only moves when the host calls advance()/stepToNext(); events at equal times run in scheduling order, so a
  run is fully deterministic for a given project, seed and sequence of user inputs.
*/

interface Scheduled {
  at: number;
  seq: number;
  fn: () => void;
  cancelled: boolean;
}

export class VirtualClock {
  now = 0;
  private seq = 0;
  private queue: Scheduled[] = [];

  schedule(at: number, fn: () => void) {
    const ev: Scheduled = { at: Math.max(at, this.now), seq: this.seq++, fn, cancelled: false };
    // keep sorted by (at, seq); queues are small, insertion is fine
    let i = this.queue.length;
    while (i > 0 && (this.queue[i - 1].at > ev.at || (this.queue[i - 1].at === ev.at && this.queue[i - 1].seq > ev.seq))) i--;
    this.queue.splice(i, 0, ev);
    return { cancel: () => { ev.cancelled = true; } };
  }

  /** Time of the next pending event, or null. */
  peek(): number | null {
    while (this.queue.length && this.queue[0].cancelled) this.queue.shift();
    return this.queue.length ? this.queue[0].at : null;
  }

  /**
   * Run every event up to and including `until`, then set now = until. With a wall-clock `deadline`
   * (performance.now() value) it stops early once real time runs out, leaving now at the last event run, and returns
   * false: the caller simply continues on the next frame, so a heavy simulation slows down instead of freezing.
   */
  advanceTo(until: number, guard = 100_000, deadline = Infinity) {
    let ran = 0;
    for (;;) {
      const next = this.peek();
      if (next == null || next > until) break;
      const ev = this.queue.shift()!;
      this.now = ev.at;
      ev.fn();
      if (++ran > guard) throw new Error('Too many events in one step: is a rule re-triggering itself?');
      if (deadline !== Infinity && (ran & 7) === 0 && performance.now() > deadline) return false;
    }
    this.now = Math.max(this.now, until);
    return true;
  }

  advance(ms: number) { return this.advanceTo(this.now + ms); }

  clear() {
    this.queue = [];
    this.now = 0;
    this.seq = 0;
  }

  get pending() { return this.queue.filter((e) => !e.cancelled).length; }
}

/** Small seeded PRNG (mulberry32) for sensor jitter and floating inputs. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
