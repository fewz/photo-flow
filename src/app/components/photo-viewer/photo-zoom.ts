/** Pinch-zoom math for the photo viewer. Offsets are in px from the centre of the viewer. */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** `content`: the photo's on-screen size at scale 1 (object-fit: contain); `viewer`: the screen. */
export interface Frame {
  content: Size;
  viewer: Size;
}

export interface ZoomState {
  scale: number;
  x: number;
  y: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;
export const DOUBLE_TAP_ZOOM = 2.5;
export const NO_ZOOM: ZoomState = { scale: 1, x: 0, y: 0 };

/**
 * Zooms to `scale` so the photo point that was under `from` ends up under `to`
 * (both relative to the viewer centre). Used for pinch (fingers' midpoint) and double tap.
 */
export function zoomAround(start: ZoomState, scale: number, from: Point, to: Point, frame: Frame): ZoomState {
  const nextScale = clamp(scale, MIN_ZOOM, MAX_ZOOM);
  // Photo coordinates (unscaled, from the photo centre) of the anchor point.
  const anchorX = (from.x - start.x) / start.scale;
  const anchorY = (from.y - start.y) / start.scale;
  return clampPan({ scale: nextScale, x: to.x - anchorX * nextScale, y: to.y - anchorY * nextScale }, frame);
}

/** Moves a zoomed photo by the finger's travel, without letting it leave the screen. */
export function pan(start: ZoomState, dx: number, dy: number, frame: Frame): ZoomState {
  return clampPan({ ...start, x: start.x + dx, y: start.y + dy }, frame);
}

/**
 * A zoomed photo may move until its edge meets the screen edge; while it is smaller than the
 * screen on an axis it stays centred on that axis.
 */
export function clampPan(state: ZoomState, { content, viewer }: Frame): ZoomState {
  const maxX = Math.max(0, (content.width * state.scale - viewer.width) / 2);
  const maxY = Math.max(0, (content.height * state.scale - viewer.height) / 2);
  return { scale: state.scale, x: clamp(state.x, -maxX, maxX), y: clamp(state.y, -maxY, maxY) };
}

/** On-screen size of a photo fitted into the viewer with object-fit: contain. */
export function containedSize(natural: Size, viewer: Size): Size {
  if (natural.width <= 0 || natural.height <= 0) {
    return viewer;
  }
  const ratio = Math.min(viewer.width / natural.width, viewer.height / natural.height);
  return { width: natural.width * ratio, height: natural.height * ratio };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function clamp(value: number, min: number, max: number): number {
  // `|| 0` turns -0 into 0.
  return Math.min(max, Math.max(min, value)) || 0;
}
