// Type declarations for the vendored Colorfigures engine (core.js). Only what ESP32 Lab uses is typed precisely.
export type V3 = [number, number, number];
export type UV = [number, number];
export interface Mat { l: string; m: string; d: string }
export interface DepthItem { at?: V3; box?: [V3, V3]; svg: string }

export const PALS: Record<'mustard' | 'tomato' | 'mint' | 'cobalt' | 'blush', Mat>;
export const METAL: Mat, CLEAR: Mat, CERAMIC: Mat, DARK: Mat, BOARD: Mat, WOOD: Mat;
export const INK: string, SHADOW: string, LIN: V3, YAW0: number, PITCH0: number, INK_REF_VB: number, CORE_CSS: string;
export const C: number, S: number;
export const VIEW_NAMES: string[];

export function camBasis(yaw: number, pitch: number): { R: V3; U: V3; V: V3 };
export function setCam(yaw: number, pitch: number): void;
export function camDot(a: V3, b: V3): number;
export function rotV(n: V3): V3;
export function yawTurn(p: UV): UV;
export function P0(x: number, y: number, z: number): UV;
export function P(x: number, y: number, z: number): UV;
export function Dv(x: number, y: number, z: number): UV;
export function depthOf(p: V3): number;
export function boxMid(b: [V3, V3]): V3;
export function sepOrder(p: DepthItem, q: DepthItem): number;
export function byDepth(parts: (DepthItem | null | undefined | false)[]): string;
export function nearHalf(): UV;
export function farHalf(): UV;
export function openShell(A: V3[], B: V3[], colour: (n: V3) => string, contents?: string): string;
export function f(v: number): string;
export function pd(pts: V3[], close?: boolean): string;
export function sp(pts: UV[]): string;
export function arcUV(cu: number, cv: number, r: number, a0: number, a1: number, n?: number): UV[];
export function rrUV(u0: number, v0: number, u1: number, v1: number, r: number, n?: number): UV[];
export function rectUV(u0: number, v0: number, u1: number, v1: number): UV[];
export function ellUV(cu: number, cv: number, ru: number, rv: number, n?: number): UV[];
export function PX(x: number): (uv: UV) => V3;
export function PY(y: number): (uv: UV) => V3;
export function PZ(z: number): (uv: UV) => V3;
export function on(plane: (uv: UV) => V3, uv: UV[]): V3[];
export function sub(a: V3, b: V3): V3;
export function dot(a: V3, b: V3): number;
export function cross(a: V3, b: V3): V3;
export function norm(a: V3): V3;
export function avg(ps: V3[]): V3;
export function vis(n: V3): boolean;
export function facing(n: V3): boolean;
export function setLight(deg: number): void;
export function tone(n: V3, m: Mat): string;
export function toneI(n: V3, m: Mat): string;
export function mix(a: string, b: string, t: number): string;
export function matOf(hex: string): Mat;
export function ease(t: number): number;
export function ink(d: string, w?: number): string;
export function fill(d: string, c: string, extra?: string): string;
export function face(d: string, c: string): string;
export function shape(pts: V3[], c: string, w?: number): string;
export function line(pts: V3[], w?: number): string;
export function loft(A: V3[], B: V3[], colour: (n: V3) => string, flip?: boolean): string;
export function hull(pts: UV[]): UV[];
export function hullInk(pts3: V3[], w?: number): string;
export function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: Mat, shade?: (n: V3, m: Mat) => string, w?: number): string;
export function extrude(profileUV: UV[], x0: number, x1: number, m: Mat, shade?: (n: V3, m: Mat) => string): string;
export function cyl(x: number, y: number, z0: number, z1: number, r: number, m: Mat, shade?: (n: V3, m: Mat) => string, w?: number, n?: number): string;
export function cylX(x0: number, x1: number, y: number, z: number, r: number, m: Mat, shade?: (n: V3, m: Mat) => string, w?: number, n?: number): string;
export function rod(a: V3, b: V3, r: number, m: Mat, shade?: (n: V3, m: Mat) => string, w?: number, r1?: number, n?: number): string;
export function txM(o: UV, U: UV, V: UV): string;
export function tx(x: number, y: number, z: number, str: string, size: number, col?: string, weight?: number): string;
export function txY(x: number, y: number, z: number, str: string, size: number, col?: string, weight?: number): string;
export function castShadow(pts3: V3[], z0?: number, clip?: V3[] | null): string;
export function boardTop(x0: number, y0: number, x1: number, y1: number, h?: number, r?: number): V3[];
export function board(x0: number, y0: number, x1: number, y1: number, h?: number, r?: number, m?: Mat): string;
export function act(name: string, inner: string, data?: string): string;
export function tag(p3: V3, dx: number, dy: number, text: string, on?: boolean): string;
export function clipTo(pts3: V3[], inner: string): string;
export function inkScale(svg: string): string;
export function filterFor(k: number): string;
export function bakeNoise(svg: SVGSVGElement): void;

export interface FigureUI {
  st: Record<string, any>;
  render(): void;
  animate(step: (dt: number) => boolean | void): void;
  flash(text: string, ms?: number): void;
  invalidate(): void;
}
export function mountFigure(cfg: Record<string, any>): FigureUI;
export function xrCallouts(items: { at: V3; text: string; on?: boolean }[], B: number[]): string;
export function xrMount(getUI: () => FigureUI, caption: (st: any) => string, opt?: { labelsOnly?: boolean }): void;

export function setFrame(o: { ox?: number; oy?: number; rc?: UV; rcz?: number; inkK?: number }): void;
export function resetClips(): void;
export function setCamLimit(v: number | null): void;
export function camState(): { yaw: number; pitch: number; R: V3; U: V3; V: V3; D: V3; inkK: number; ox: number; oy: number };
