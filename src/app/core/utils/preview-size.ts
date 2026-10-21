import { MAX_PREVIEW_SIZE, REVIEW_PREVIEW_SIZE } from '../constants/app.constants';

export interface Viewport {
  width: number;
  height: number;
  pixelRatio: number;
}

// Rounded up so small viewport changes reuse the same cached preview.
const SIZE_STEP = 256;

/**
 * Edge of the square box a full-screen preview is fitted into: the screen's longest side in
 * physical pixels, so photos are not upscaled on high-density screens. Never the original.
 */
export function fullScreenPreviewSize(viewport: Viewport = currentViewport()): number {
  const longest = Math.max(viewport.width, viewport.height) * (viewport.pixelRatio || 1);
  const stepped = Math.ceil(longest / SIZE_STEP) * SIZE_STEP;
  return Math.min(MAX_PREVIEW_SIZE, Math.max(REVIEW_PREVIEW_SIZE, stepped));
}

function currentViewport(): Viewport {
  if (typeof window === 'undefined') {
    return { width: 0, height: 0, pixelRatio: 1 };
  }
  return { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio };
}
