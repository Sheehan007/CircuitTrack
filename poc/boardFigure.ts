// Proof of concept: the ESP32 board as a standalone Colorfigures figure page (mountFigure page shell, drag to turn,
// labels), with a postMessage bridge so a host page can push simulator state in and receive part events out.
//
// Messages in  (host -> figure): { type: 'cf:state', state: Partial<BoardVisual> }
// Messages out (figure -> host): { type: 'cf:ready' } | { type: 'cf:event', event: 'press' | 'release' | 'terminal', target }
//                                | { type: 'cf:rendered', led2, powered }
import { Dv, mountFigure, YAW0 } from '../src/figures/engine/core.js';
import { BOARD_BOX, boardShadow, drawEsp32Doit, type BoardVisual } from '../src/figures/parts/esp32Doit';

const W = BOARD_BOX[1][0] - BOARD_BOX[0][0];
const D = BOARD_BOX[1][1] - BOARD_BOX[0][1];
const H = BOARD_BOX[1][2];

const st: BoardVisual & Record<string, unknown> = { powered: true, led2: 0, enDown: false, bootDown: false, silk: true, hot: {} };
const post = (msg: unknown) => parent !== window && parent.postMessage(msg, '*');

const ui = mountFigure({
  fig: 'ESP32',
  title: 'DOIT ESP32 DevKit V1',
  size: [W, D, H],
  palette: 'cobalt',
  state: st,
  turn: 'full',
  credit: true,
  scene: () => {
    // the drawing is centred on the board; the frame expects [0..W] x [0..D], so shift by half the box
    const [dx, dy] = Dv(W / 2, D / 2, 0);
    return `<g transform="translate(${dx.toFixed(2)} ${dy.toFixed(2)})">${boardShadow()}${drawEsp32Doit(st)}</g>`;
  },
  buttons: [
    { label: 'Press EN', onClick: () => post({ type: 'cf:event', event: 'press', target: 'EN' }) },
  ],
  acts: {
    press(s: BoardVisual, el: SVGElement, u: { render(): void }) {
      const target = el.dataset.target as 'EN' | 'BOOT';
      if (target === 'EN') s.enDown = true; else s.bootDown = true;
      post({ type: 'cf:event', event: 'press', target });
      const up = () => {
        s.enDown = s.bootDown = false;
        post({ type: 'cf:event', event: 'release', target });
        u.render();
        removeEventListener('pointerup', up);
      };
      addEventListener('pointerup', up);
    },
    term(s: BoardVisual, el: SVGElement) {
      const term = el.dataset.term!;
      s.hot = { [term]: '#f4b829' };
      post({ type: 'cf:event', event: 'terminal', target: term, label: el.dataset.label });
    },
  },
});
void YAW0;

addEventListener('message', (e: MessageEvent) => {
  const m = e.data;
  if (!m || m.type !== 'cf:state') return;
  Object.assign(st, m.state);
  ui.render();
  const glowing = document.querySelectorAll('#art .glow').length;
  post({ type: 'cf:rendered', led2: st.led2, powered: st.powered, glowLayers: glowing });
});
(window as unknown as { __board: unknown }).__board = { st, ui };
post({ type: 'cf:ready' });
