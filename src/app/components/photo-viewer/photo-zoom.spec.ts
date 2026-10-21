import { clampPan, containedSize, Frame, MAX_ZOOM, NO_ZOOM, pan, zoomAround } from './photo-zoom';

// A 4:3 landscape photo fitted into a 400 x 800 portrait screen: 400 x 300 on screen.
const frame: Frame = { viewer: { width: 400, height: 800 }, content: { width: 400, height: 300 } };

describe('photo zoom', () => {
  it('fits a photo into the screen like object-fit: contain', () => {
    expect(containedSize({ width: 4000, height: 3000 }, frame.viewer)).toEqual({ width: 400, height: 300 });
    expect(containedSize({ width: 0, height: 0 }, frame.viewer)).toEqual(frame.viewer);
  });

  it('keeps the pinched point under the fingers', () => {
    const anchor = { x: 100, y: 50 };
    const zoomed = zoomAround(NO_ZOOM, 2, anchor, anchor, frame);

    expect(zoomed.scale).toBe(2);
    // The photo point under the fingers (100, 50) is drawn at x + 100 * 2, y + 50 * 2.
    expect(zoomed.x + 100 * 2).toBe(100);
    // Vertically the zoomed photo (600 px) still fits the 800 px screen, so it stays centred.
    expect(zoomed.y).toBe(0);
  });

  it('stays between 1x and the maximum zoom', () => {
    const center = { x: 0, y: 0 };
    expect(zoomAround(NO_ZOOM, 0.3, center, center, frame)).toEqual(NO_ZOOM);
    expect(zoomAround(NO_ZOOM, 50, center, center, frame).scale).toBe(MAX_ZOOM);
  });

  it('pans only as far as the photo edge', () => {
    const zoomed = { scale: 4, x: 0, y: 0 };
    // 1600 x 1200 on a 400 x 800 screen: up to 600 px sideways, 200 px up or down.
    expect(pan(zoomed, 1000, -1000, frame)).toEqual({ scale: 4, x: 600, y: -200 });
    expect(clampPan({ scale: 1, x: 30, y: 30 }, frame)).toEqual(NO_ZOOM);
  });
});
