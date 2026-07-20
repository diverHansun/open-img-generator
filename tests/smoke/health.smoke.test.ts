import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createIntegrationDb } from '../helpers/integration';

process.env.FAL_KEY = 'test-fal-key';

const { tempFile, cleanup } = createIntegrationDb();

const { GET: getHealth } = await import('../../src/app/api/health/route');

describe('health smoke', () => {
  afterAll(() => {
    cleanup();
  });

  it('returns ok with enabled providers and db ok', async () => {
    const response = await getHealth(
      new Request('http://localhost:3000/api/health'),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.db).toBe('ok');
    expect(body.enabledProviders).toContain('fal');
  });
});
