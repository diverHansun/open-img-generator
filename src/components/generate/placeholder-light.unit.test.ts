import { describe, expect, it } from 'vitest';

import { placeholderLight } from './placeholder-light';

const seconds = (value: string | undefined) => Number.parseFloat(value ?? '');

describe('placeholderLight', () => {
  it('is stable for the same job', () => {
    expect(placeholderLight('job-a')).toEqual(placeholderLight('job-a'));
  });

  it('gives neighbouring jobs different light', () => {
    const ids = ['job-a', 'job-b', 'job-c', 'job-d', 'job-e', 'job-f'];
    const signatures = new Set(
      ids.map((id) => {
        const light = placeholderLight(id);
        return [light['--light-c1'], light['--light-angle'], light['--light-drift']].join('|');
      }),
    );
    expect(signatures.size).toBe(ids.length);
  });

  it('keeps every motion in a calm, readable tempo', () => {
    for (let i = 0; i < 200; i += 1) {
      const light = placeholderLight(`job-${i}`);
      expect(seconds(light['--light-drift'])).toBeGreaterThanOrEqual(11);
      expect(seconds(light['--light-drift'])).toBeLessThanOrEqual(15);
      expect(seconds(light['--light-fold'])).toBeGreaterThanOrEqual(14);
      expect(seconds(light['--light-fold'])).toBeLessThanOrEqual(19);
      expect(seconds(light['--light-halo'])).toBeGreaterThanOrEqual(8);
      expect(seconds(light['--light-halo'])).toBeLessThanOrEqual(11);
      expect(seconds(light['--light-sheen'])).toBeGreaterThanOrEqual(5.5);
      expect(seconds(light['--light-sheen'])).toBeLessThanOrEqual(7.5);
      expect(seconds(light['--light-drift-delay'])).toBeLessThanOrEqual(0);
    }
  });
});
