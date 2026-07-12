import { describe, it, expect } from 'vitest';
import { createTestDb } from '../../../../tests/helpers/db';
import {
  createSession,
  updateSession,
  touchSession,
  sessionExists,
  getSession,
} from './sessions';
import { createGenerationAndJob } from './generations';

const now = '2026-07-12T10:00:00.000Z';

function makeSessionParams(overrides: { id?: string; title?: string } = {}) {
  return {
    id: overrides.id ?? 'session-1',
    title: overrides.title ?? 'Demo Session',
    createdAt: now,
    updatedAt: now,
  };
}

describe('sessions queries', () => {
  it('creates a session with created_at and updated_at equal', () => {
    const { db } = createTestDb();
    const session = createSession(makeSessionParams(), db);
    expect(session.title).toBe('Demo Session');
    expect(session.createdAt).toBe(now);
    expect(session.updatedAt).toBe(now);
  });

  it('updates title and changes updated_at', () => {
    const { db } = createTestDb();
    createSession(makeSessionParams(), db);
    const later = '2026-07-12T11:00:00.000Z';
    const updated = updateSession('session-1', { title: 'Renamed', updatedAt: later }, db);
    expect(updated.title).toBe('Renamed');
    expect(updated.updatedAt).toBe(later);
  });

  it('touches session updated_at without changing title', () => {
    const { db } = createTestDb();
    createSession(makeSessionParams(), db);
    const later = '2026-07-12T11:00:00.000Z';
    touchSession('session-1', later, db);
    const found = getSession('session-1', db);
    expect(found.updatedAt).toBe(later);
    expect(found.title).toBe('Demo Session');
  });

  it('returns true when session exists and false otherwise', () => {
    const { db } = createTestDb();
    createSession(makeSessionParams({ id: 'exists' }), db);
    expect(sessionExists('exists', db)).toBe(true);
    expect(sessionExists('missing', db)).toBe(false);
  });

  it('gets session with empty generations when none linked', () => {
    const { db } = createTestDb();
    createSession(makeSessionParams(), db);
    const found = getSession('session-1', db);
    expect(found.generations).toEqual([]);
  });

  it('lists generations linked to session', () => {
    const { db } = createTestDb();
    createSession(makeSessionParams(), db);
    createGenerationAndJob(
      {
        id: 'gen-1',
        sessionId: 'session-1',
        prompt: 'A cat',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'job-1',
        generationId: 'gen-1',
        provider: 'fal',
        model: 'fal-ai/flux/schnell',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      },
      db,
    );
    const found = getSession('session-1', db);
    expect(found.generations).toHaveLength(1);
    expect(found.generations[0].jobs).toHaveLength(1);
  });
});
