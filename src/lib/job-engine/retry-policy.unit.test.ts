import { describe, expect, it } from 'vitest';

import {
  decideRetry,
  fullJitterDelayMs,
  resetRetryState,
} from './retry-policy';

const nowMs = Date.parse('2026-07-20T00:00:00.000Z');

describe('retry policy', () => {
  it('schedules the first poll failure with a bounded full-jitter delay', () => {
    expect(decideRetry(
      'poll',
      { attemptCount: 0, retryStartedAt: null },
      { now: () => nowMs, random: () => 0 },
    )).toEqual({
      kind: 'scheduled',
      attemptCount: 1,
      retryStartedAt: '2026-07-20T00:00:00.000Z',
      delayMs: 250,
      nextAttemptAt: '2026-07-20T00:00:00.250Z',
    });
  });

  it('uses the supplied jitter source and never escapes the configured ceiling', () => {
    const decision = decideRetry(
      'poll',
      { attemptCount: 4, retryStartedAt: '2026-07-20T00:00:00.000Z' },
      { now: () => nowMs, random: () => 1 },
    );
    expect(decision).toMatchObject({
      kind: 'scheduled',
      attemptCount: 5,
      delayMs: 32_000,
    });
    expect(fullJitterDelayMs(60_000, 1)).toBe(60_000);
    expect(fullJitterDelayMs(60_000, -1)).toBe(250);
  });

  it('does not schedule calls beyond the poll, cancel, or download budgets', () => {
    expect(decideRetry(
      'poll',
      { attemptCount: 5, retryStartedAt: '2026-07-20T00:00:00.000Z' },
      { now: () => nowMs, random: () => 0 },
    )).toEqual({ kind: 'exhausted', reason: 'attempt_limit' });
    expect(decideRetry(
      'cancel',
      { attemptCount: 2, retryStartedAt: '2026-07-20T00:00:00.000Z' },
      { now: () => nowMs, random: () => 0 },
    )).toEqual({ kind: 'exhausted', reason: 'attempt_limit' });
    expect(decideRetry(
      'download',
      { attemptCount: 2, retryStartedAt: '2026-07-20T00:00:00.000Z' },
      { now: () => nowMs, random: () => 0 },
    )).toEqual({ kind: 'exhausted', reason: 'attempt_limit' });
  });

  it('only permits two safe submit replays and honors a Retry-After floor', () => {
    expect(decideRetry(
      'submit',
      { attemptCount: 0, retryStartedAt: null },
      { now: () => nowMs, random: () => 0, minimumDelayMs: 5_000 },
    )).toMatchObject({
      kind: 'scheduled',
      attemptCount: 1,
      delayMs: 5_000,
    });
    expect(decideRetry(
      'submit',
      { attemptCount: 2, retryStartedAt: '2026-07-20T00:00:00.000Z' },
      { now: () => nowMs, random: () => 0 },
    )).toEqual({ kind: 'exhausted', reason: 'attempt_limit' });
    expect(decideRetry(
      'submit',
      { attemptCount: 0, retryStartedAt: null },
      { now: () => nowMs, random: () => 0, minimumDelayMs: 30_001 },
    )).toEqual({ kind: 'exhausted', reason: 'elapsed_budget' });
  });

  it('exhausts elapsed windows and corrupt persisted retry state safely', () => {
    expect(decideRetry(
      'poll',
      { attemptCount: 1, retryStartedAt: '2026-07-19T23:50:00.000Z' },
      { now: () => nowMs, random: () => 0 },
    )).toEqual({ kind: 'exhausted', reason: 'elapsed_budget' });
    expect(decideRetry(
      'cancel',
      { attemptCount: -1, retryStartedAt: null },
      { now: () => nowMs, random: () => 0 },
    )).toEqual({ kind: 'exhausted', reason: 'invalid_state' });
    expect(decideRetry(
      'cancel',
      { attemptCount: 0, retryStartedAt: 'not-a-time' },
      { now: () => nowMs, random: () => 0 },
    )).toEqual({ kind: 'exhausted', reason: 'invalid_state' });
    expect(decideRetry(
      'poll',
      { attemptCount: 1, retryStartedAt: null },
      { now: () => nowMs, random: () => 0 },
    )).toEqual({ kind: 'exhausted', reason: 'invalid_state' });
    expect(decideRetry(
      'poll',
      { attemptCount: 0, retryStartedAt: '2026-07-20T00:00:00.000Z' },
      { now: () => nowMs, random: () => 0 },
    )).toEqual({ kind: 'exhausted', reason: 'invalid_state' });
  });

  it('resets phase-local retry state after a successful transition or terminal outcome', () => {
    expect(resetRetryState()).toEqual({ attemptCount: 0, retryStartedAt: null });
  });
});
