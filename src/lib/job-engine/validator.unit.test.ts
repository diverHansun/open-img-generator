import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../../tests/helpers/db';
import { createSession } from '../db/queries/sessions';
import { validate } from './validator';
import type { SubmitGenerationParams } from './types';

describe('validator', () => {
  let db: ReturnType<typeof createTestDb>['db'];
  const originalEnv = { ...process.env };

  beforeEach(() => {
    db = createTestDb().db;
    process.env.FAL_KEY = 'test-fal-key';
    process.env.ZENMUX_API_KEY = 'test-zenmux-key';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function makeParams(overrides: Partial<SubmitGenerationParams> = {}): SubmitGenerationParams {
    return {
      targets: [{ provider: 'fal', model: 'fal-ai/flux/schnell' }],
      prompt: 'A cat',
      sessionId: 'default-session',
      ...overrides,
    };
  }

  it('passes for a valid Fal request', () => {
    expect(() => validate(makeParams(), { db })).not.toThrow();
  });

  it('rejects an empty target list', () => {
    expect(() => validate(makeParams({ targets: [] }), { db })).toThrow('At least one target');
  });

  it('rejects a request that exceeds the bounded fan-out limit', () => {
    expect(() =>
      validate(
        makeParams({
          targets: Array.from({ length: 9 }, (_, index) => ({
            provider: 'fal' as const,
            model: `model-${index}`,
          })),
        }),
        { db },
      ),
    ).toThrow('At most 8 targets');
  });

  it('rejects duplicate targets', () => {
    expect(() =>
      validate(
        makeParams({
          targets: [
            { provider: 'fal', model: 'fal-ai/flux/schnell' },
            { provider: 'fal', model: 'fal-ai/flux/schnell' },
          ],
        }),
        { db },
      ),
    ).toThrow('Duplicate target');
  });

  it('throws when a target provider is not enabled', () => {
    delete process.env.FAL_KEY;
    expect(() => validate(makeParams(), { db })).toThrow('Provider not enabled: fal');
  });

  it('throws when a target model is not found', () => {
    expect(() =>
      validate(makeParams({ targets: [{ provider: 'fal', model: 'unknown/model' }] }), { db }),
    ).toThrow('Model not found');
  });

  it('throws when count exceeds a selected target maximum', () => {
    expect(() => validate(makeParams({ count: 10 }), { db })).toThrow('Count 10 exceeds max 4');
  });

  it('throws when a sync target uses count greater than one', () => {
    expect(() =>
      validate(
        makeParams({
          targets: [{ provider: 'zenmux', model: 'openai/gpt-image-2' }],
          count: 2,
        }),
        { db },
      ),
    ).toThrow('Sync provider supports count=1 only in MVP');
  });

  it('allows a seed when only some selected targets support it', () => {
    expect(() =>
      validate(
        makeParams({
          targets: [
            { provider: 'fal', model: 'fal-ai/flux/schnell' },
            { provider: 'zenmux', model: 'openai/gpt-image-2' },
          ],
          seed: 42,
        }),
        { db },
      ),
    ).not.toThrow();
  });

  it('rejects a negative prompt when any selected target does not support it', () => {
    expect(() =>
      validate(makeParams({ negativePrompt: 'bad' }), { db }),
    ).toThrow('Negative prompt not supported by every selected target');
  });

  it('rejects an aspect ratio not supported by every selected target', () => {
    expect(() =>
      validate(
        makeParams({
          targets: [
            { provider: 'fal', model: 'fal-ai/flux/schnell' },
            { provider: 'zenmux', model: 'openai/gpt-image-2' },
          ],
          aspectRatio: '16:9',
        }),
        { db },
      ),
    ).toThrow('Unsupported aspect ratio');
  });

  it('throws when session is not found', () => {
    expect(() => validate(makeParams({ sessionId: 'missing' }), { db })).toThrow('Session not found');
  });

  it('passes when session exists', () => {
    createSession({ id: 's1', projectId: 'default-project', title: 'Test', createdAt: 'now', updatedAt: 'now' }, db);
    expect(() => validate(makeParams({ sessionId: 's1' }), { db })).not.toThrow();
  });

  it('treats explicit null optional values as omitted at the API boundary', () => {
    expect(() =>
      validate(
        makeParams({
          width: null,
          height: null,
          aspectRatio: null,
          count: null,
          negativePrompt: null,
          seed: null,
          providerOptions: null,
        }),
        { db },
      ),
    ).not.toThrow();
  });

  it('accepts width and height together', () => {
    expect(() => validate(makeParams({ width: 960, height: 1280 }), { db })).not.toThrow();
  });

  it('rejects incomplete or invalid dimensions', () => {
    expect(() => validate(makeParams({ width: 960 }), { db })).toThrow(
      'Width and height must be provided together',
    );
    expect(() => validate(makeParams({ width: 0, height: 1280 }), { db })).toThrow(
      'Width and height must be positive integers',
    );
    expect(() => validate(makeParams({ width: 960.5, height: 1280 }), { db })).toThrow(
      'Width and height must be positive integers',
    );
  });
});
