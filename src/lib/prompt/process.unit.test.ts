import { describe, it, expect } from 'vitest';
import { process } from './process';

describe('prompt.process', () => {
  it('returns the input prompt unchanged in MVP', () => {
    const input = 'A cat wearing a space helmet';
    expect(process(input)).toBe(input);
  });

  it('handles empty prompt', () => {
    expect(process('')).toBe('');
  });
});
