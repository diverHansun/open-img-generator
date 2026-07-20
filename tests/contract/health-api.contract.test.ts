import { beforeEach, describe, it, expect, vi } from 'vitest';
import { GET as getHealth } from '../../src/app/api/health/route';
import { GET as getLiveness } from '../../src/app/api/health/live/route';

vi.mock('../../src/lib/providers', () => ({
  listEnabled: vi.fn(),
}));

vi.mock('../../src/lib/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/lib/db')>();
  return {
    ...original,
    inspectDatabaseCompatibility: vi.fn(),
  };
});

vi.mock('../../src/lib/job-engine', () => ({
  ensureWorkerStarted: vi.fn(),
}));

import * as providers from '../../src/lib/providers';
import * as database from '../../src/lib/db';
import * as jobEngine from '../../src/lib/job-engine';

function compatibility(overrides: Partial<database.DatabaseCompatibilityReport> = {}) {
  return {
    ready: true,
    currentVersion: 1,
    requiredVersion: 1,
    foreignKeysEnabled: true,
    missingTables: [],
    missingColumns: [],
    missingIndexes: [],
    ...overrides,
  } satisfies database.DatabaseCompatibilityReport;
}

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.mocked(database.inspectDatabaseCompatibility).mockReset();
    vi.mocked(database.inspectDatabaseCompatibility).mockReturnValue(compatibility());
    vi.mocked(jobEngine.ensureWorkerStarted).mockReset();
  });

  it('returns ok with enabled providers', async () => {
    vi.mocked(providers.listEnabled).mockReturnValue([
      { id: 'fal', displayName: 'fal.ai', models: [] },
    ]);
    const response = await getHealth();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.enabledProviders).toEqual(['fal']);
    expect(body.db).toBe('ok');
    expect(body.schema).toEqual({ currentVersion: 1, requiredVersion: 1 });
    expect(jobEngine.ensureWorkerStarted).toHaveBeenCalledOnce();
  });

  it('returns 503 and does not start the worker when the schema is incompatible', async () => {
    vi.mocked(database.inspectDatabaseCompatibility).mockReturnValue(
      compatibility({
        ready: false,
        currentVersion: 0,
        missingColumns: ['generation_jobs.next_poll_at'],
      }),
    );
    vi.mocked(providers.listEnabled).mockReturnValue([]);

    const response = await getHealth();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe('error');
    expect(body.error.code).toBe('SCHEMA_NOT_READY');
    expect(body.error.retryable).toBe(false);
    expect(body.error.details).toEqual({
      currentVersion: 0,
      requiredVersion: 1,
      foreignKeysEnabled: true,
      missingTables: [],
      missingColumns: ['generation_jobs.next_poll_at'],
      missingIndexes: [],
    });
    expect(body.schema.missingColumns).toEqual(['generation_jobs.next_poll_at']);
    expect(jobEngine.ensureWorkerStarted).not.toHaveBeenCalled();
  });

  it('returns 503 without exposing the database error', async () => {
    vi.mocked(database.inspectDatabaseCompatibility).mockImplementation(() => {
      throw new Error('unable to open /private/app.db');
    });

    const response = await getHealth();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toMatchObject({
      code: 'DATABASE_UNAVAILABLE',
      retryable: true,
    });
    expect(JSON.stringify(body)).not.toContain('/private/app.db');
    expect(jobEngine.ensureWorkerStarted).not.toHaveBeenCalled();
  });

  it('does not misreport worker startup failures as database failures', async () => {
    vi.mocked(jobEngine.ensureWorkerStarted).mockImplementation(() => {
      throw new Error('worker failed');
    });

    const response = await getHealth();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      status: 'error',
      db: 'ok',
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Service initialization failed',
        retryable: true,
      },
    });
  });
});

describe('GET /api/health/live', () => {
  it('reports process liveness without inspecting the database or starting the worker', async () => {
    vi.mocked(database.inspectDatabaseCompatibility).mockReset();
    vi.mocked(jobEngine.ensureWorkerStarted).mockReset();
    const response = await getLiveness();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
    expect(database.inspectDatabaseCompatibility).not.toHaveBeenCalled();
    expect(jobEngine.ensureWorkerStarted).not.toHaveBeenCalled();
  });
});
