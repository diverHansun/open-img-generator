import { describe, expect, it } from 'vitest';

import { acceptProviderRemoteImage, RemoteImageUrlError } from './remote-url';

describe('remote image URL policy', () => {
  it('accepts a declared Provider media host without resolving or fetching it', () => {
    expect(acceptProviderRemoteImage(
      'qwen',
      'qwen-image-2.0-pro',
      'https://dashscope-7c2c.oss-accelerate.aliyuncs.com/result.png?token=secret',
    )).toMatchObject({
      hostname: 'dashscope-7c2c.oss-accelerate.aliyuncs.com',
      expiresAt: null,
    });
  });

  it.each([
    'http://v3.fal.media/result.png',
    'https://127.0.0.1/result.png',
    'https://localhost/result.png',
    'https://v3.fal.media/result.png#fragment',
    'https://attacker.example/result.png',
  ])('rejects unsafe or undeclared URL %s', (url) => {
    expect(() => acceptProviderRemoteImage(
      'fal',
      'fal-ai/flux/schnell',
      url,
    )).toThrow(RemoteImageUrlError);
  });

  it('does not let a suffix-like attacker hostname match', () => {
    expect(() => acceptProviderRemoteImage(
      'fal',
      'fal-ai/flux/schnell',
      'https://fal.media.attacker.example/result.png',
    )).toThrow('not declared');
  });
});
