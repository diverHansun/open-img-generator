import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SchemaNotReadyError,
  ValidationError,
} from '../../lib/errors';
import { handleApiError } from './error-handler';

describe('API error handler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('correlates structured errors without exposing arbitrary validation text', async () => {
    const canary = 'secret-canary prompt https://example.test/?token=private';

    const response = handleApiError(new ValidationError(canary), {
      structured: true,
      requestId: 'request-1234',
    });

    expect(response.status).toBe(400);
    expect(response.headers.get('X-Request-Id')).toBe('request-1234');
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        retryable: false,
        requestId: 'request-1234',
      },
    });
  });

  it('whitelists schema details and filters unsafe identifiers', async () => {
    const error = new SchemaNotReadyError({
      currentVersion: 0,
      requiredVersion: 1,
      foreignKeysEnabled: true,
      missingTables: ['generation_jobs', 'unsafe table'],
      missingColumns: ['generation_jobs.next_poll_at', 'https://private.test'],
      missingIndexes: ['jobs_due_index'],
      ignored: 'secret-canary',
    } as never);

    const response = handleApiError(error, {
      structured: true,
      requestId: 'request-5678',
    });

    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'SCHEMA_NOT_READY',
        message: 'Database schema is not ready',
        retryable: false,
        requestId: 'request-5678',
        details: {
          currentVersion: 0,
          requiredVersion: 1,
          foreignKeysEnabled: true,
          missingTables: ['generation_jobs'],
          missingColumns: ['generation_jobs.next_poll_at'],
          missingIndexes: ['jobs_due_index'],
        },
      },
    });
  });

  it('redacts unexpected errors from both the response and structured log', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const canary = 'secret-canary /private/app.db https://signed.test/?token=private';

    const response = handleApiError(new Error(canary), {
      structured: true,
      requestId: 'request-9012',
    });
    const bodyText = await response.text();
    const logText = errorSpy.mock.calls.flat().join(' ');

    expect(response.status).toBe(500);
    expect(bodyText).toContain('request-9012');
    expect(bodyText).not.toContain(canary);
    expect(logText).toContain('request-9012');
    expect(logText).not.toContain(canary);
    expect(logText).not.toContain('/private/app.db');
    expect(logText).not.toContain('token=private');
  });

  it('supports conservative retry semantics for an unexpected write error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = handleApiError(new Error('provider outcome is unknown'), {
      structured: true,
      requestId: 'request-write-1',
      unexpectedRetryable: false,
    });

    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        retryable: false,
        requestId: 'request-write-1',
      },
    });
  });

  it('preserves the legacy body for endpoints that did not opt into structure', async () => {
    const response = handleApiError(new ValidationError('Existing safe message'));

    expect(response.headers.has('X-Request-Id')).toBe(false);
    await expect(response.json()).resolves.toEqual({
      error: 'Existing safe message',
    });
  });
});
