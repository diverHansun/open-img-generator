import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getById, listEnabled } from './registry';

describe('registry', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.FAL_KEY;
    delete process.env.ZENMUX_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns undefined when provider key is missing', () => {
    expect(getById('fal')).toBeUndefined();
    expect(getById('zenmux')).toBeUndefined();
  });

  it('returns fal provider when FAL_KEY is set', () => {
    process.env.FAL_KEY = 'test-key';
    const provider = getById('fal');
    expect(provider).toBeDefined();
    expect(provider?.id).toBe('fal');
    expect(provider?.capabilities.has('fal-ai/flux/schnell')).toBe(true);
  });

  it('returns zenmux provider when ZENMUX_API_KEY is set', () => {
    process.env.ZENMUX_API_KEY = 'test-key';
    const provider = getById('zenmux');
    expect(provider).toBeDefined();
    expect(provider?.id).toBe('zenmux');
  });

  it('lists only enabled providers', () => {
    process.env.FAL_KEY = 'test-key';
    const enabled = listEnabled();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].id).toBe('fal');
    expect(enabled[0].models).toHaveLength(1);
  });

  it('returns empty array when no keys configured', () => {
    expect(listEnabled()).toEqual([]);
  });
});
