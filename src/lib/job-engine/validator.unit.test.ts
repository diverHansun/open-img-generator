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
      provider: 'fal',
      model: 'fal-ai/flux/schnell',
      prompt: 'A cat',
      ...overrides,
    };
  }

  it('passes for valid fal request', () => {
    expect(() => validate(makeParams(), { db })).not.toThrow();
  });

  it('throws when provider not enabled', () => {
    delete process.env.FAL_KEY;
    expect(() => validate(makeParams(), { db })).toThrow('Provider not enabled');
  });

  it('throws when model not found', () => {
    expect(() => validate(makeParams({ model: 'unknown/model' }), { db })).toThrow('Model not found');
  });

  it('throws when count exceeds max', () => {
    expect(() => validate(makeParams({ count: 10 }), { db })).toThrow('Count 10 exceeds max 4');
  });

  it('throws when sync provider count > 1', () => {
    expect(() =>
      validate(makeParams({ provider: 'zenmux', model: 'openai/gpt-image-2', count: 2 }), { db }),
    ).toThrow('Sync provider supports count=1 only in MVP');
  });

  it('throws when seed not supported', () => {
    expect(() =>
      validate(makeParams({ provider: 'zenmux', model: 'openai/gpt-image-2', seed: 42 }), { db }),
    ).toThrow('Seed not supported');
  });

  it('throws when negative prompt not supported', () => {
    expect(() =>
      validate(makeParams({ negativePrompt: 'bad' }), { db }),
    ).toThrow('Negative prompt not supported');
  });

  it('throws when session not found', () => {
    expect(() => validate(makeParams({ sessionId: 'missing' }), { db })).toThrow('Session not found');
  });

  it('passes when session exists', () => {
    createSession({ id: 's1', title: 'Test', createdAt: 'now', updatedAt: 'now' }, db);
    expect(() => validate(makeParams({ sessionId: 's1' }), { db })).not.toThrow();
  });

  it('throws for unsupported size', () => {
    expect(() =>
      validate(makeParams({ provider: 'zenmux', model: 'openai/gpt-image-2', width: 999, height: 999 }), { db }),
    ).toThrow('Unsupported size');
  });
});
