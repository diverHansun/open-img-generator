import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getById, listEnabled } from './registry';

describe('registry', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.FAL_KEY;
    delete process.env.ZENMUX_API_KEY;
    delete process.env.SILICONFLOW_API_KEY;
    delete process.env.ZHIPU_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns undefined when provider key is missing', () => {
    expect(getById('fal')).toBeUndefined();
    expect(getById('zenmux')).toBeUndefined();
    expect(getById('siliconflow')).toBeUndefined();
    expect(getById('zhipu')).toBeUndefined();
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

  it('returns siliconflow provider when SILICONFLOW_API_KEY is set', () => {
    process.env.SILICONFLOW_API_KEY = 'test-key';
    const provider = getById('siliconflow');
    expect(provider).toBeDefined();
    expect(provider?.id).toBe('siliconflow');
    expect(provider?.capabilities.has('Kwai-Kolors/Kolors')).toBe(true);
  });

  it('returns zhipu provider when ZHIPU_API_KEY is set', () => {
    process.env.ZHIPU_API_KEY = 'test-key';
    const provider = getById('zhipu');
    expect(provider).toBeDefined();
    expect(provider?.id).toBe('zhipu');
    expect(provider?.capabilities.has('glm-image')).toBe(true);
  });

  it('lists only enabled providers', () => {
    process.env.FAL_KEY = 'test-key';
    process.env.SILICONFLOW_API_KEY = 'test-key';
    process.env.ZHIPU_API_KEY = 'test-key';
    const enabled = listEnabled();
    expect(enabled).toHaveLength(3);
    expect(enabled[0].id).toBe('fal');
    expect(enabled[1].id).toBe('siliconflow');
    expect(enabled[2].id).toBe('zhipu');
  });

  it('returns empty array when no keys configured', () => {
    expect(listEnabled()).toEqual([]);
  });
});
