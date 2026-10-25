// localStorage persistence. Every access is guarded: private windows, blocked storage or full quotas just mean
// nothing is remembered, never a broken page.
import { validateProject, type Project } from '../sim/project';

const K = {
  projects: 'esp32lab:v1:projects',
  current: 'esp32lab:v1:current',
  progress: 'esp32lab:v1:progress',
  settings: 'esp32lab:v1:settings',
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function listProjects(): Project[] {
  const all = read<Record<string, unknown>>(K.projects, {});
  const out: Project[] = [];
  for (const raw of Object.values(all)) {
    try { out.push(validateProject(raw)); } catch { /* skip damaged entries */ }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveProject(p: Project): boolean {
  const all = read<Record<string, Project>>(K.projects, {});
  all[p.id] = p;
  return write(K.projects, all);
}

export function deleteProject(id: string) {
  const all = read<Record<string, Project>>(K.projects, {});
  delete all[id];
  write(K.projects, all);
}

export const getCurrentId = () => read<string | null>(K.current, null);
export const setCurrentId = (id: string | null) => write(K.current, id);

export interface Progress {
  lessons: Record<string, { done: number[]; completed: boolean }>;
}
export const loadProgress = () => read<Progress>(K.progress, { lessons: {} });
export const saveProgress = (p: Progress) => write(K.progress, p);

export interface Settings {
  labels: 'none' | 'wired' | 'all';
  wobble: boolean;
  timestamps: boolean;
  theme: 'auto' | 'light' | 'dark';
  sound: boolean;
}
export const DEFAULT_SETTINGS: Settings = { labels: 'wired', wobble: true, timestamps: false, theme: 'auto', sound: false };
// sound always starts off: browsers only allow audio after a click anyway
export const loadSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(K.settings, {}), sound: false });
export const saveSettings = (s: Settings) => write(K.settings, s);

export function exportProject(p: Project) {
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${p.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'project'}.esp32lab.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importProjectFile(file: File): Promise<Project> {
  const text = await file.text();
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('That file is not JSON.'); }
  return validateProject(raw);
}
