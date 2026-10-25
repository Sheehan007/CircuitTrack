import type { V3 } from '../engine/core.js';

export interface DrawCtx {
  partId: string;
  params: Record<string, any>;
  visual: Record<string, any>;
  /** Terminal id → ring colour (hovered, wired, draft wire). */
  hot: Record<string, string>;
}

export interface PartDrawing {
  /** Inked body, hand-drawn filter applied. */
  body: string;
  /** Unfiltered layer above the body: LED glow, display pixels. */
  overlay: string;
  /** Cast shadow on the paper. */
  shadow: string;
}

export type PartDrawer = (c: DrawCtx) => PartDrawing;

export type { V3 };
