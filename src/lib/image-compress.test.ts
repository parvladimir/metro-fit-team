import { describe, expect, it } from 'vitest';
import { fitWithin } from './image-compress';

describe('fitWithin', () => {
  it('keeps small images untouched', () => {
    expect(fitWithin(800, 600, 1800)).toEqual({ width: 800, height: 600 });
  });
  it('scales a 4032x3024 iPhone photo down keeping aspect ratio', () => {
    expect(fitWithin(4032, 3024, 1800)).toEqual({ width: 1800, height: 1350 });
  });
  it('scales portrait images by their longer side', () => {
    expect(fitWithin(3024, 4032, 1800)).toEqual({ width: 1350, height: 1800 });
  });
});
