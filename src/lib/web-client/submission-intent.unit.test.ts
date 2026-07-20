import { describe, expect, it } from 'vitest';

import type { SubmitGenerationPayload } from './types';
import {
  canonicalizeSubmissionPayload,
  clearSubmissionIntent,
  hashSubmissionPayload,
  resolveSubmissionIntent,
  submissionIntentPolicy,
} from './submission-intent';

function payload(overrides: Partial<SubmitGenerationPayload> = {}): SubmitGenerationPayload {
  return {
    prompt: 'A quiet reading room',
    sessionId: 'session-1',
    targets: [{ provider: 'fal', model: 'fal-ai/flux/schnell' }],
    ...overrides,
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    value: (key: string) => values.get(key) ?? null,
  };
}

const hashPayload = async (value: SubmitGenerationPayload) => {
  const canonical = canonicalizeSubmissionPayload(value);
  return `hash:${Array.from(canonical).reduce(
    (hash, character) => ((hash * 31 + character.charCodeAt(0)) >>> 0),
    17,
  ).toString(16)}`;
};

describe('submission intent', () => {
  it('canonically identifies unchanged content independent of object key order', () => {
    expect(
      canonicalizeSubmissionPayload(
        payload({ providerOptions: { beta: 2, alpha: 1 } }),
      ),
    ).toBe(
      canonicalizeSubmissionPayload(
        payload({ providerOptions: { alpha: 1, beta: 2 } }),
      ),
    );
  });

  it('uses an opaque SHA-256 payload hash rather than storing prompt content', async () => {
    const hash = await hashSubmissionPayload(payload());

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('quiet');
  });

  it('reuses unchanged project/session intent without persisting the prompt', async () => {
    const storage = memoryStorage();
    let ids = 0;
    const options = {
      storage,
      now: () => 1_000,
      createId: () => `id-${++ids}`,
      hashPayload,
    };

    const first = await resolveSubmissionIntent(
      { projectId: 'project-1', sessionId: 'session-1', payload: payload() },
      options,
    );
    const replay = await resolveSubmissionIntent(
      { projectId: 'project-1', sessionId: 'session-1', payload: payload() },
      options,
    );

    expect(first).toMatchObject({ reused: false, intent: { clientRequestId: 'id-1' } });
    expect(replay).toMatchObject({ reused: true, intent: { clientRequestId: 'id-1' } });
    expect(storage.value(submissionIntentPolicy.storageKey)).not.toContain(
      'A quiet reading room',
    );
    clearSubmissionIntent('id-1', { storage });
  });

  it('replaces intent after a content change, scope change, or TTL expiry', async () => {
    const storage = memoryStorage();
    let now = 1_000;
    let ids = 0;
    const options = {
      storage,
      now: () => now,
      createId: () => `id-${++ids}`,
      hashPayload,
    };

    const first = await resolveSubmissionIntent(
      { projectId: 'project-1', sessionId: 'session-1', payload: payload() },
      options,
    );
    const changed = await resolveSubmissionIntent(
      {
        projectId: 'project-1',
        sessionId: 'session-1',
        payload: payload({ prompt: 'A changed room' }),
      },
      options,
    );
    const scopeChanged = await resolveSubmissionIntent(
      {
        projectId: 'project-2',
        sessionId: 'session-1',
        payload: payload({ prompt: 'A changed room' }),
      },
      options,
    );
    now += submissionIntentPolicy.ttlMs;
    const expired = await resolveSubmissionIntent(
      {
        projectId: 'project-2',
        sessionId: 'session-1',
        payload: payload({ prompt: 'A changed room' }),
      },
      options,
    );

    expect([
      first.intent.clientRequestId,
      changed.intent.clientRequestId,
      scopeChanged.intent.clientRequestId,
      expired.intent.clientRequestId,
    ]).toEqual(['id-1', 'id-2', 'id-3', 'id-4']);
    clearSubmissionIntent('id-4', { storage });
  });

  it('clears only the intent that received a definitive response', async () => {
    const storage = memoryStorage();
    const options = {
      storage,
      now: () => 1_000,
      createId: () => 'id-active',
      hashPayload,
    };
    await resolveSubmissionIntent(
      { projectId: 'project-1', sessionId: 'session-1', payload: payload() },
      options,
    );

    clearSubmissionIntent('id-stale', { storage });
    expect(storage.value(submissionIntentPolicy.storageKey)).not.toBeNull();
    clearSubmissionIntent('id-active', { storage });
    expect(storage.value(submissionIntentPolicy.storageKey)).toBeNull();
  });

  it('recovers from a malformed persisted intent', async () => {
    const storage = memoryStorage({
      [submissionIntentPolicy.storageKey]: '{not-json',
    });
    const result = await resolveSubmissionIntent(
      { projectId: 'project-1', sessionId: 'session-1', payload: payload() },
      {
        storage,
        now: () => 1_000,
        createId: () => 'id-recovered',
        hashPayload,
      },
    );

    expect(result).toMatchObject({ reused: false, intent: { clientRequestId: 'id-recovered' } });
    clearSubmissionIntent('id-recovered', { storage });
  });

  it('keeps the same request key when browser storage is unavailable', async () => {
    let ids = 0;
    const options = {
      storage: null,
      now: () => 1_000,
      createId: () => `id-unavailable-${++ids}`,
      hashPayload,
    };
    const input = {
      projectId: 'project-storage-unavailable',
      sessionId: 'session-storage-unavailable',
      payload: payload({ prompt: 'Storage unavailable retry' }),
    };

    const first = await resolveSubmissionIntent(input, options);
    const replay = await resolveSubmissionIntent(input, options);

    expect(first).toMatchObject({
      reused: false,
      intent: { clientRequestId: 'id-unavailable-1' },
    });
    expect(replay).toMatchObject({
      reused: true,
      intent: { clientRequestId: 'id-unavailable-1' },
    });
    clearSubmissionIntent('id-unavailable-1', { storage: null });
  });

  it('keeps the same request key when storage rejects a write', async () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => undefined,
    };
    let ids = 0;
    const options = {
      storage,
      now: () => 1_000,
      createId: () => `id-write-failure-${++ids}`,
      hashPayload,
    };
    const input = {
      projectId: 'project-write-failure',
      sessionId: 'session-write-failure',
      payload: payload({ prompt: 'Storage write failure retry' }),
    };

    const first = await resolveSubmissionIntent(input, options);
    const replay = await resolveSubmissionIntent(input, options);

    expect(first).toMatchObject({
      reused: false,
      intent: { clientRequestId: 'id-write-failure-1' },
    });
    expect(replay).toMatchObject({
      reused: true,
      intent: { clientRequestId: 'id-write-failure-1' },
    });
    clearSubmissionIntent('id-write-failure-1', { storage });
  });
});
