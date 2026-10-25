/*
  Data feeds for projects like the crypto ticker. Offline, every feed is SIMULATED: a deterministic random walk driven
  by the virtual clock, so runs repeat exactly and nobody mistakes it for a real price. A live source can be plugged in
  later by registering a provider with the same shape (the engine only ever calls value()).
*/
export interface DataFeed {
  id: string;
  label: string;
  unit: string;
  /** Always shown next to the value in the UI and in generated code. */
  simulated: boolean;
  value(tMs: number): number;
}

function randomWalk(seed: number, start: number, volatility: number) {
  const steps: number[] = [start];
  let s = seed >>> 0;
  const rand = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return (tMs: number) => {
    const k = Math.max(0, Math.floor(tMs / 1000));
    while (steps.length <= k) {
      const prev = steps[steps.length - 1];
      // mean-reverting walk so the simulated price wanders but never runs away
      const drift = (start - prev) / start * 0.02;
      steps.push(prev * (1 + drift + (rand() - 0.5) * volatility));
    }
    return steps[k];
  };
}

const FEEDS: Record<string, DataFeed> = {
  btc: { id: 'btc', label: 'BTC/USD (simulated)', unit: 'USD', simulated: true, value: randomWalk(11, 67000, 0.004) },
  eth: { id: 'eth', label: 'ETH/USD (simulated)', unit: 'USD', simulated: true, value: randomWalk(22, 3400, 0.006) },
  sol: { id: 'sol', label: 'SOL/USD (simulated)', unit: 'USD', simulated: true, value: randomWalk(33, 160, 0.009) },
};

export const FEED_IDS = Object.keys(FEEDS);
export const getFeed = (id: string) => FEEDS[id];
/** Replace a feed (e.g. with a live provider). Keep `simulated: false` only for real data. */
export const registerFeed = (f: DataFeed) => { FEEDS[f.id] = f; };
