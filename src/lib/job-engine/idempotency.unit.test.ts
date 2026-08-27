import { describe, expect, it } from 'vitest';

import { ValidationError } from '../errors';
import {
  canonicalizeGenerationPayload,
  hashGenerationPayload,
  normalizeClientRequestId,
  prepareGenerationIdempotency,
} from './idempotency';

const CLIENT_REQUEST_ID = '15a6fecc-4f40-4ed2-8f51-353423be9af1';

function request(overrides: Record<string, unknown> = {}) {
  return {
    clientRequestId: CLIENT_REQUEST_ID,
    sessionId: 'session-1',
    prompt: 'A cat',
    targets: [
      { provider: 'fal', model: 'fal-ai/flux/schnell' },
      { provider: 'qwen', model: 'qwen-image' },
    ],
    providerOptions: {
      nested: { beta: 2, alpha: 1 },
      quality: 'standard',
    },
    ...overrides,
  };
}

describe('generation idempotency', () => {
  it('sorts object keys recursively and excludes clientRequestId', () => {
    const first = request();
    const second = {
      providerOptions: {
        quality: 'standard',
        nested: { alpha: 1, beta: 2 },
      },
      targets: [
        { model: 'fal-ai/flux/schnell', provider: 'fal' },
        { model: 'qwen-image', provider: 'qwen' },
      ],
      prompt: 'A cat',
      sessionId: 'session-1',
      clientRequestId: '550E8400-E29B-41D4-A716-446655440000',
    };

    expect(canonicalizeGenerationPayload(first)).toBe(
      canonicalizeGenerationPayload(second),
    );
    expect(hashGenerationPayload(first)).toBe(hashGenerationPayload(second));
  });

  it('preserves target array order', () => {
    const reversed = request({
      targets: [...request().targets].reverse(),
    });

    expect(hashGenerationPayload(request())).not.toBe(
      hashGenerationPayload(reversed),
    );
  });

  it('omits undefined object properties while retaining null', () => {
    const omitted = request();
    const undefinedValue = request({ negativePrompt: undefined });
    const nullValue = request({ negativePrompt: null });

    expect(hashGenerationPayload(undefinedValue)).toBe(
      hashGenerationPayload(omitted),
    );
    expect(hashGenerationPayload(nullValue)).not.toBe(
      hashGenerationPayload(omitted),
    );
  });

  it('produces a stable lowercase SHA-256 digest', () => {
    expect(hashGenerationPayload(request())).toMatch(/^[0-9a-f]{64}$/);
    expect(hashGenerationPayload(request())).toBe(
      '3f101dc0b689d7110965680376ad8e2c4f3b2e51a8faeeb8ca6a4c8618302712',
    );
  });

  it.each([
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    '987fbc97-4bed-5078-af07-9141ba07c9f3',
  ])('accepts RFC 4122 UUID versions and variants: %s', (value) => {
    expect(normalizeClientRequestId(value.toUpperCase())).toBe(value);
  });

  it.each([
    undefined,
    '',
    '550e8400e29b41d4a716446655440000',
    '550e8400-e29b-01d4-a716-446655440000',
    '550e8400-e29b-41d4-7716-446655440000',
  ])('rejects a non-RFC-4122 clientRequestId: %s', (value) => {
    expect(() => normalizeClientRequestId(value)).toThrow(ValidationError);
  });

  it('prepares the normalized client key and payload hash for admission', () => {
    const input = request({
      clientRequestId: CLIENT_REQUEST_ID.toUpperCase(),
    });

    expect(prepareGenerationIdempotency(input)).toEqual({
      clientRequestId: CLIENT_REQUEST_ID,
      requestHash: hashGenerationPayload(input),
    });
  });

  it('rejects circular and non-JSON payload values', () => {
    const circular: Record<string, unknown> = request();
    circular.providerOptions = circular;

    expect(() => hashGenerationPayload(circular)).toThrow(ValidationError);
    expect(() => hashGenerationPayload(request({ seed: Number.NaN }))).toThrow(
      ValidationError,
    );
  });
});
