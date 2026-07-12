import { describe, it, expect, vi } from 'vitest';
import { GET as getHealth } from '../../src/app/api/health/route';

vi.mock('../../src/lib/providers', () => ({
  listEnabled: vi.fn(),
}));

vi.mock('../../src/lib/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/lib/db')>();
  return {
    ...original,
    db: {
      ...original.db,
      run: vi.fn(),
    },
  };
});

import * as providers from '../../src/lib/providers';
import { db } from '../../src/lib/db';

describe('GET /api/health', () => {
  it('returns ok with enabled providers', async () => {
    vi.mocked(providers.listEnabled).mockReturnValue([
      { id: 'fal', displayName: 'fal.ai', models: [] },
    ]);
    vi.mocked(db.run).mockImplementation(() => ({ changes: 1, lastInsertRowid: 0 }));

    const response = await getHealth();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.enabledProviders).toEqual(['fal']);
    expect(body.db).toBe('ok');
  });

  it('returns 500 when db check fails', async () => {
    vi.mocked(providers.listEnabled).mockReturnValue([]);
    vi.mocked(db.run).mockImplementation(() => {
      throw new Error('db down');
    });

    const response = await getHealth();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.status).toBe('error');
  });
});
