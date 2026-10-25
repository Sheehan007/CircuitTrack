// Built-in 16 × 16 pixel sprites for the TFT. Each row is 16 characters; each character picks a colour from the
// sprite's palette ('.' is transparent). Original artwork for ESP32 Lab.
import type { Sprite } from './colorFramebuffer';

interface Def { label: string; palette: Record<string, string>; rows: string[] }

const DEFS: Record<string, Def> = {
  sun: { label: 'Sun', palette: { y: '#ffd23f', o: '#ff9f1c' }, rows: [
    '.......o........', '...o...o...o....', '....o.....o.....', '......yyy.......', '....yyyyyyy.....', '...yyyyyyyyy....',
    'oo.yyyyyyyyy.oo.', '...yyyyyyyyy....', '...yyyyyyyyy....', '....yyyyyyy.....', '......yyy.......', '....o.....o.....',
    '...o...o...o....', '.......o........', '................', '................'] },
  cloud: { label: 'Cloud', palette: { w: '#f4f7fb', g: '#b9c4d0' }, rows: [
    '................', '................', '................', '.....wwww.......', '....wwwwww......', '..wwwwwwwwww....',
    '.wwwwwwwwwwwww..', 'wwwwwwwwwwwwwww.', 'wwwwwwwwwwwwwww.', 'gwwwwwwwwwwwwwg.', '.ggggggggggggg..', '................',
    '................', '................', '................', '................'] },
  rain: { label: 'Rain', palette: { w: '#dfe6ee', g: '#9aa7b6', b: '#4aa3ff' }, rows: [
    '.....wwww.......', '....wwwwww......', '..wwwwwwwwww....', '.wwwwwwwwwwwww..', 'wwwwwwwwwwwwwww.', 'gggggggggggggg..',
    '................', '..b...b...b.....', '.b...b...b......', '................', '....b...b...b...', '...b...b...b....',
    '................', '..b...b...b.....', '.b...b...b......', '................'] },
  drop: { label: 'Water drop', palette: { b: '#3d9bff', l: '#a9d4ff' }, rows: [
    '.......b........', '.......b........', '......bbb.......', '......bbb.......', '.....bbbbb......', '.....bbbbb......',
    '....bbbbbbb.....', '...bblbbbbbb....', '...blbbbbbbb....', '..bblbbbbbbbb...', '..bblbbbbbbbb...', '..bbbbbbbbbbb...',
    '...bbbbbbbbb....', '....bbbbbbb.....', '......bbb.......', '................'] },
  thermo: { label: 'Thermometer', palette: { w: '#f1f1f1', r: '#ff4d3a', k: '#7a7a7a' }, rows: [
    '......kkk.......', '.....kwwwk......', '.....kwwwk..k...', '.....kwrwk......', '.....kwrwk..k...', '.....kwrwk......',
    '.....kwrwk..k...', '.....kwrwk......', '.....kwrwk......', '....kwrrrwk.....', '...kwrrrrrwk....', '...krrrrrrrk....',
    '...krrrrrrrk....', '....krrrrrk.....', '.....kkkkk......', '................'] },
  heart: { label: 'Heart', palette: { r: '#ff3b5c', p: '#ff9fb0' }, rows: [
    '................', '................', '..rrr.....rrr...', '.rpprr...rrrrr..', 'rpprrrr.rrrrrrr.', 'rprrrrrrrrrrrrr.',
    'rrrrrrrrrrrrrrr.', 'rrrrrrrrrrrrrrr.', '.rrrrrrrrrrrrr..', '..rrrrrrrrrrr...', '...rrrrrrrrr....', '....rrrrrrr.....',
    '.....rrrrr......', '......rrr.......', '.......r........', '................'] },
  note: { label: 'Music note', palette: { k: '#ffd23f' }, rows: [
    '........kkkkkk..', '........kkkkkk..', '........k....k..', '........k....k..', '........k....k..', '........k....k..',
    '........k....k..', '........k....k..', '........k....k..', '....kkk.k..kkk..', '...kkkkkk.kkkkk.', '...kkkkkk.kkkkk.',
    '....kkkk...kkk..', '................', '................', '................'] },
  coin: { label: 'Coin (₿-style)', palette: { o: '#f7931a', y: '#ffc66d', w: '#ffffff' }, rows: [
    '.....oooooo.....', '...oooooooooo...', '..oooyyyyyyooo..', '.ooyyww.ww.yyoo.', '.ooyywwwwwwyyoo.', 'ooyyywwyyywwyyoo',
    'ooyyywwyyywwyyoo', 'ooyyywwwwwwyyyoo', 'ooyyywwyyywwyyoo', 'ooyyywwyyywwyyoo', '.ooyywwwwwwyyoo.', '.ooyyww.ww.yyoo.',
    '..oooyyyyyyooo..', '...oooooooooo...', '.....oooooo.....', '................'] },
  up: { label: 'Arrow up', palette: { g: '#35d07f' }, rows: [
    '.......g........', '......ggg.......', '.....ggggg......', '....ggggggg.....', '...ggggggggg....', '..ggggggggggg...',
    '.....ggggg......', '.....ggggg......', '.....ggggg......', '.....ggggg......', '.....ggggg......', '.....ggggg......',
    '................', '................', '................', '................'] },
  down: { label: 'Arrow down', palette: { r: '#ff5a4f' }, rows: [
    '................', '................', '................', '................', '.....rrrrr......', '.....rrrrr......',
    '.....rrrrr......', '.....rrrrr......', '.....rrrrr......', '.....rrrrr......', '..rrrrrrrrrrr...', '...rrrrrrrrr....',
    '....rrrrrrr.....', '.....rrrrr......', '......rrr.......', '.......r........'] },
  smile: { label: 'Smiley', palette: { y: '#ffd23f', k: '#3b2b00' }, rows: [
    '.....yyyyyy.....', '...yyyyyyyyyy...', '..yyyyyyyyyyyy..', '.yyyykyyyykyyyy.', '.yyyykyyyykyyyy.', 'yyyyyyyyyyyyyyyy',
    'yyyyyyyyyyyyyyyy', 'yyyyyyyyyyyyyyyy', 'yykyyyyyyyyyykyy', '.yykyyyyyyyykyy.', '.yyykkyyyykkyyy.', '..yyyykkkkyyyy..',
    '...yyyyyyyyyy...', '.....yyyyyy.....', '................', '................'] },
};

export const SPRITE_NAMES = Object.keys(DEFS);
export const spriteLabel = (name: string) => DEFS[name]?.label ?? name;

const cache = new Map<string, Sprite>();
export function builtinSprite(name: string): Sprite | null {
  const d = DEFS[name];
  if (!d) return null;
  let s = cache.get(name);
  if (!s) {
    s = { w: 16, h: 16, px: d.rows.join('').split('').map((ch) => d.palette[ch] ?? null) };
    cache.set(name, s);
  }
  return s;
}

/** Program-defined sprites (e.g. an uploaded image) are stored as rows of "#rrggbb" or "" (transparent). */
export function customSprite(def: { w: number; h: number; px: string[] }): Sprite {
  return { w: def.w, h: def.h, px: def.px.map((p) => p || null) };
}
