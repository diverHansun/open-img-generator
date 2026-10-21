import { describe, expect, it } from 'vitest';

import { clampWorkbenchWidth, readWorkbenchWidth, workbenchWidthBounds } from './workbench-layout';

describe('workbench width preference', () => {
  it.each([null, '', ' ', 'garbage', 'NaN', 'Infinity'])('uses the default for an invalid preference: %s', (stored) => {
    expect(readWorkbenchWidth(stored)).toBe(356);
  });

  it('restores and sanitizes a saved width', () => {
    expect(readWorkbenchWidth('480')).toBe(480);
    expect(readWorkbenchWidth('480.4')).toBe(480);
    expect(readWorkbenchWidth('-1')).toBe(300);
    expect(readWorkbenchWidth('100000')).toBe(640);
  });

  it('leaves space for the canvas and the drag gutter', () => {
    expect(workbenchWidthBounds(900)).toEqual({ min: 300, max: 522 });
    expect(clampWorkbenchWidth(640, 900)).toBe(522);
    expect(clampWorkbenchWidth(356, 900)).toBe(356);
  });

  it('does not round beyond a fractional container boundary', () => {
    expect(workbenchWidthBounds(900.8).max).toBe(522);
    expect(clampWorkbenchWidth(640, 900.8)).toBe(522);
  });

  it('keeps a valid range before measurement and on the stacked layout', () => {
    expect(workbenchWidthBounds(0)).toEqual({ min: 300, max: 640 });
    expect(workbenchWidthBounds(320)).toEqual({ min: 300, max: 300 });
    expect(clampWorkbenchWidth(Number.NaN)).toBe(356);
    expect(clampWorkbenchWidth(0)).toBe(300);
  });

  it('clamps the visible layout without destroying the saved preference', () => {
    const preference = readWorkbenchWidth('600');
    expect(clampWorkbenchWidth(preference, 800)).toBe(422);
    expect(clampWorkbenchWidth(preference, 1200)).toBe(600);
  });
});
