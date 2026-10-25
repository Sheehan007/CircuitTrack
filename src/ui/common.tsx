import type { ComponentChildren } from 'preact';

const PATHS: Record<string, string> = {
  play: 'M7 5l12 7-12 7z',
  pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  step: 'M6 5l9 7-9 7zM17 5h2v14h-2z',
  reset: 'M5 12a7 7 0 1 0 2-5M5 4v4h4',
  rotl: 'M8 7H4V3M4.6 7A8 8 0 1 1 4 12',
  rotr: 'M16 7h4V3M19.4 7A8 8 0 1 0 20 12',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  copy: 'M8 8h11v11H8zM5 16V5h11',
  trash: 'M5 7h14M10 11v6M14 11v6M7 7l1 12h8l1-12M9 7V4h6v3',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  folder: 'M3 7h7l2 2h9v10H3z',
  check: 'M5 12l5 5 9-10',
  warn: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  info: 'M12 8v.5M12 11v6',
  x: 'M6 6l12 12M18 6L6 18',
  chevron: 'M9 6l6 6-6 6',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  board: 'M4 6h16v12H4zM8 6V3M12 6V3M16 6V3M8 21v-3M12 21v-3M16 21v-3',
  book: 'M4 5h7a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 5h-7',
  wrench: 'M14 6a4 4 0 0 0 5 5l-9 9-3-3 9-9a4 4 0 0 1-2-2z',
  sound: 'M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
  mute: 'M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6',
  stop: 'M6 6h12v12H6z',
  code: 'M9 7l-5 5 5 5M15 7l5 5-5 5',
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d={PATHS[name] ?? ''} fill={name === 'play' || name === 'pause' || name === 'step' || name === 'stop' ? 'currentColor' : 'none'} />
    </svg>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: ComponentChildren }[]; value: T; onChange: (id: T) => void; label: string }) {
  const onKey = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === value);
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = tabs[(i + d + tabs.length) % tabs.length];
    onChange(next.id);
    (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus();
  };
  return (
    <div class="tabs" role="tablist" aria-label={label} onKeyDown={onKey as any}>
      {tabs.map((t) => (
        <button key={t.id} data-tab={t.id} role="tab" aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1} class={t.id === value ? 'on' : ''} onClick={() => onChange(t.id)}>{t.label}</button>
      ))}
    </div>
  );
}

export const fmtTime = (ms: number) => {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(3)} s` : `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};

export function Empty({ children }: { children: ComponentChildren }) {
  return <p class="empty">{children}</p>;
}
