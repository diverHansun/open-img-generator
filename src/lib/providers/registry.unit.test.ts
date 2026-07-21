import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getById, listEnabled } from './registry';

describe('registry', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.FAL_KEY;
    delete process.env.ZENMUX_API_KEY;
    delete process.env.SILICONFLOW_API_KEY;
    delete process.env.ZHIPU_API_KEY;
    delete process.env.ARK_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;
    delete process.env.KLING_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns undefined when provider key is missing', () => {
    expect(getById('fal')).toBeUndefined();
    expect(getById('zenmux')).toBeUndefined();
    expect(getById('siliconflow')).toBeUndefined();
    expect(getById('zhipu')).toBeUndefined();
    expect(getById('doubao')).toBeUndefined();
    expect(getById('qwen')).toBeUndefined();
    expect(getById('kling')).toBeUndefined();
  });

  it('returns fal provider when FAL_KEY is set', () => {
    process.env.FAL_KEY = 'test-key';
    const provider = getById('fal');
    expect(provider).toBeDefined();
    expect(provider?.id).toBe('fal');
    expect(provider?.capabilities.has('fal-ai/flux/schnell')).toBe(true);
    expect(provider?.capabilities.has('fal-ai/nano-banana-2')).toBe(true);
    expect(provider?.capabilities.has('fal-ai/nano-banana-pro')).toBe(true);
  });

  it('returns zenmux provider when ZENMUX_API_KEY is set', () => {
    process.env.ZENMUX_API_KEY = 'test-key';
    const provider = getById('zenmux');
    expect(provider).toBeDefined();
    expect(provider?.id).toBe('zenmux');
    expect(provider?.capabilities.has('openai/gpt-image-1.5')).toBe(true);
  });

  it('returns siliconflow provider when SILICONFLOW_API_KEY is set', () => {
    process.env.SILICONFLOW_API_KEY = 'test-key';
    const provider = getById('siliconflow');
    expect(provider).toBeDefined();
    expect(provider?.id).toBe('siliconflow');
    expect(provider?.capabilities.has('Kwai-Kolors/Kolors')).toBe(true);
    expect(provider?.capabilities.has('Tongyi-MAI/Z-Image-Turbo')).toBe(true);
    expect(provider?.capabilities.has('Tongyi-MAI/Z-Image')).toBe(false);
  });

  it('returns zhipu provider when ZHIPU_API_KEY is set', () => {
    process.env.ZHIPU_API_KEY = 'test-key';
    const provider = getById('zhipu');
    expect(provider).toBeDefined();
    expect(provider?.id).toBe('zhipu');
    expect(provider?.capabilities.has('glm-image')).toBe(true);
  });

  it('returns doubao provider when ARK_API_KEY is set', () => {
    process.env.ARK_API_KEY = 'test-key';
    const provider = getById('doubao');
    expect(provider).toBeDefined();
    expect(provider?.id).toBe('doubao');
    expect(provider?.capabilities.has('doubao-seedream-4-0-250828')).toBe(true);
    expect(provider?.capabilities.has('doubao-seedream-4-5-251128')).toBe(true);
    expect(provider?.capabilities.has('doubao-seedream-5-0-260128')).toBe(true);
  });

  it('returns qwen provider when DASHSCOPE_API_KEY is set', () => {
    process.env.DASHSCOPE_API_KEY = 'test-key';
    const provider = getById('qwen');
    expect(provider).toBeDefined();
    expect(provider?.id).toBe('qwen');
    expect(provider?.capabilities.has('qwen-image-plus')).toBe(true);
    expect(provider?.capabilities.has('qwen-image-2.0-pro')).toBe(true);
    expect(provider?.capabilities.has('wan2.7-image-pro')).toBe(true);
  });

  it('returns kling provider when KLING_API_KEY is set', () => {
    process.env.KLING_API_KEY = 'test-key';
    const provider = getById('kling');
    expect(provider).toBeDefined();
    expect(provider?.id).toBe('kling');
    expect(provider?.capabilities.has('kling-v3')).toBe(true);
  });

  it('lists only enabled providers', () => {
    process.env.FAL_KEY = 'test-key';
    process.env.SILICONFLOW_API_KEY = 'test-key';
    process.env.ZHIPU_API_KEY = 'test-key';
    process.env.ARK_API_KEY = 'test-key';
    process.env.DASHSCOPE_API_KEY = 'test-key';
    const enabled = listEnabled();
    expect(enabled).toHaveLength(5);
    expect(enabled[0].id).toBe('fal');
    expect(enabled[1].id).toBe('siliconflow');
    expect(enabled[2].id).toBe('zhipu');
    expect(enabled[3].id).toBe('doubao');
    expect(enabled[4].id).toBe('qwen');
  });

  it('returns empty array when no keys configured', () => {
    expect(listEnabled()).toEqual([]);
  });
});
