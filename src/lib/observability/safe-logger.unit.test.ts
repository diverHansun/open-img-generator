import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { appendLocalLogLine } from './local-log-sink';
import { logApiFailure, logSafeEvent } from './safe-logger';

describe('safe API logger', () => {
  it('logs only bounded correlation metadata', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secret = 'secret-canary prompt https://example.test/image?token=private';

    logApiFailure({
      requestId: 'request-1234',
      code: 'INTERNAL_ERROR',
      status: 500,
      error: new Error(secret),
    });

    expect(errorSpy).toHaveBeenCalledOnce();
    const output = errorSpy.mock.calls.flat().join(' ');
    expect(output).toContain('request-1234');
    expect(output).toContain('INTERNAL_ERROR');
    expect(output).not.toContain(secret);
    expect(output).not.toContain('example.test');
    expect(output).not.toContain('token=private');
    errorSpy.mockRestore();
  });

  it('does not echo an invalid caller-supplied request ID', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logApiFailure({
      requestId: 'unsafe request id with spaces',
      code: 'SECRET_CANARY',
      status: 503,
    });

    const output = errorSpy.mock.calls.flat().join(' ');
    expect(output).not.toContain('unsafe request id with spaces');
    expect(output).not.toContain('SECRET_CANARY');
    expect(output).toContain('uncorrelated');
    expect(output).toContain('INTERNAL_ERROR');
    errorSpy.mockRestore();
  });

  it('persists allowlisted events without leaking raw error content', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-log-test-'));
    const original = process.env.APP_LOG_DIR;
    process.env.APP_LOG_DIR = directory;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secret = 'prompt-canary /Users/private/key https://signed.test/x?token=secret';
    try {
      logApiFailure({
        requestId: 'request-5678',
        code: 'INTERNAL_ERROR',
        status: 500,
        error: new Error(secret),
      });
      logSafeEvent({
        event: 'storage.ownership_refused',
        expectedOwnerHashPrefix: '123456789abc',
        actualOwnerHashPrefix: 'abcdef123456',
        reason: 'mismatch',
      });
      logSafeEvent({
        event: 'storage.missing_detected',
        imageId: secret,
        wasFavorite: true,
      });
      const output = fs.readFileSync(path.join(directory, 'app.jsonl'), 'utf8');
      expect(output.trim().split('\n')).toHaveLength(3);
      expect(output).toContain('storage.ownership_refused');
      expect(output).toContain('redacted');
      expect(output).not.toContain(secret);
      expect(output).not.toContain('/Users/private');
      expect(output).not.toContain('signed.test');
    } finally {
      errorSpy.mockRestore();
      if (original === undefined) delete process.env.APP_LOG_DIR;
      else process.env.APP_LOG_DIR = original;
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rotates local logs within the configured bound', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-log-rotate-'));
    try {
      for (let index = 0; index < 8; index += 1) {
        appendLocalLogLine(JSON.stringify({ index, value: 'x'.repeat(48) }), {
          directory,
          maxBytes: 100,
          rotations: 2,
        });
      }
      expect(fs.existsSync(path.join(directory, 'app.jsonl'))).toBe(true);
      expect(fs.existsSync(path.join(directory, 'app.jsonl.1'))).toBe(true);
      expect(fs.existsSync(path.join(directory, 'app.jsonl.2'))).toBe(true);
      expect(fs.existsSync(path.join(directory, 'app.jsonl.3'))).toBe(false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
