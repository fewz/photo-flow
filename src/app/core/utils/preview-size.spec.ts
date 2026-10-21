import { MAX_PREVIEW_SIZE, REVIEW_PREVIEW_SIZE } from '../constants/app.constants';
import { fullScreenPreviewSize } from './preview-size';

describe('fullScreenPreviewSize', () => {
  it('matches the longest screen side in physical pixels, rounded up', () => {
    // 412 x 915 CSS px at 2.625 = 1081 x 2402 physical px.
    expect(fullScreenPreviewSize({ width: 412, height: 915, pixelRatio: 2.625 })).toBe(2560);
    expect(fullScreenPreviewSize({ width: 360, height: 640, pixelRatio: 2 })).toBe(1280);
  });

  it('never goes below the review size or above the native limit', () => {
    expect(fullScreenPreviewSize({ width: 320, height: 480, pixelRatio: 1 })).toBe(REVIEW_PREVIEW_SIZE);
    expect(fullScreenPreviewSize({ width: 1440, height: 3200, pixelRatio: 3.5 })).toBe(MAX_PREVIEW_SIZE);
    expect(fullScreenPreviewSize({ width: 0, height: 0, pixelRatio: 0 })).toBe(REVIEW_PREVIEW_SIZE);
  });
});
