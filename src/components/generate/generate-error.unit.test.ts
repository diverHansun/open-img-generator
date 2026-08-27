import { describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '@/lib/web-client';

import {
  dispatchGenerateErrorAction,
  getGenerateErrorActionLabelKey,
  mapGenerateError,
} from './generate-error';

describe('Generate error presentation', () => {
  it.each([
    ['VALIDATION_ERROR', 'generate.error.validation', 'none'],
    [
      'CONFIGURATION_UNAVAILABLE',
      'generate.error.configuration',
      'configure-providers',
    ],
    ['RATE_LIMITED', 'generate.error.rateLimited', 'wait'],
    ['SCHEMA_NOT_READY', 'generate.error.serviceUnavailable', 'wait'],
    ['AUTHENTICATION_REQUIRED', 'generate.error.authentication', 'reload'],
    [
      'IDEMPOTENCY_KEY_REUSED',
      'generate.error.idempotencyConflict',
      'back-to-compose',
    ],
  ] as const)('maps %s without exposing the server message', (code, messageKey, action) => {
    const presentation = mapGenerateError(
      new ApiClientError('secret raw provider response', 503, code, false),
      'submit',
    );

    expect(presentation).toMatchObject({ messageKey, action });
    expect(JSON.stringify(presentation)).not.toContain('secret raw provider response');
  });

  it('keeps correlation and bounded wait context for rate limits', () => {
    expect(
      mapGenerateError(
        new ApiClientError(
          'wait',
          429,
          'QUEUE_SATURATED',
          true,
          'request-123',
          9_001,
        ),
        'submit',
      ),
    ).toEqual({
      messageKey: 'generate.error.rateLimited',
      action: 'wait',
      requestId: 'request-123',
      retryAfterSeconds: 10,
    });
  });

  it('treats submit network and internal failures as outcome-unknown without blind retry', () => {
    expect(mapGenerateError(new TypeError('fetch failed'), 'submit')).toEqual({
      messageKey: 'generate.error.outcomeUnknown',
      action: 'check-history',
      requestId: undefined,
      retryAfterSeconds: undefined,
    });
    expect(
      mapGenerateError(
        new ApiClientError('internal', 500, 'INTERNAL_ERROR', true, 'req-500'),
        'submit',
      ),
    ).toMatchObject({
      messageKey: 'generate.error.outcomeUnknown',
      action: 'check-history',
      requestId: 'req-500',
    });
  });

  it('maps missing detail to the editor and bootstrap failure to reload', () => {
    expect(
      mapGenerateError(
        new ApiClientError('missing', 404, 'NOT_FOUND', false),
        'detail',
      ),
    ).toMatchObject({
      messageKey: 'generate.error.notFound',
      action: 'back-to-compose',
    });
    expect(mapGenerateError(new Error('offline'), 'bootstrap')).toMatchObject({
      messageKey: 'generate.error.serviceUnavailable',
      action: 'reload',
    });
    expect(mapGenerateError(new Error('deadline exceeded'), 'detail')).toMatchObject({
      messageKey: 'generate.error.serviceUnavailable',
      action: 'wait',
    });
  });

  it.each([
    ['configure-providers', 'generate.error.action.configureProviders'],
    ['check-history', 'generate.error.action.checkHistory'],
    ['reload', 'generate.error.action.reload'],
    ['back-to-compose', 'generate.error.action.backToCompose'],
    ['wait', 'generate.error.action.retry'],
    ['none', null],
  ] as const)('maps the %s action to its stable label', (action, labelKey) => {
    expect(getGenerateErrorActionLabelKey(action)).toBe(labelKey);
  });

  it('dispatches only the selected action when a handler is available', () => {
    const reload = vi.fn();
    const checkHistory = vi.fn();
    const retry = vi.fn();

    expect(
      dispatchGenerateErrorAction('reload', {
        reload,
        'check-history': checkHistory,
      }),
    ).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(checkHistory).not.toHaveBeenCalled();
    expect(dispatchGenerateErrorAction('wait', { wait: retry })).toBe(true);
    expect(retry).toHaveBeenCalledOnce();
    expect(dispatchGenerateErrorAction('none', { reload })).toBe(false);
    expect(dispatchGenerateErrorAction('wait', { reload })).toBe(false);
  });
});
