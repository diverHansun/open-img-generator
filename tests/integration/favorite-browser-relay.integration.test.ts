import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';

import { createIntegrationRuntime } from '../helpers/integration';
import { registerMswLifecycle } from '../msw/lifecycle';
import { server } from '../msw/server';

const runtime = createIntegrationRuntime();
const sqlite = new Database(runtime.database.tempFile);
sqlite.pragma('foreign_keys = ON');

const { POST: postFavorite } = await import('../../src/app/api/favorites/route');
const { POST: postPin } = await import('../../src/app/api/images/[id]/pin/route');
const { db } = await import('../../src/lib/db');
const { listFavorites } = await import('../../src/lib/library');

registerMswLifecycle();

describe('favorite browser relay integration', () => {
  afterAll(() => {
    sqlite.close();
    runtime.cleanup();
  });

  it('fails the server download, accepts browser bytes, then retries as a managed favorite', async () => {
    const remoteUrl = 'https://v3.fal.media/relay-result.png';
    sqlite.exec(`
      INSERT INTO generations
        (id, session_id, prompt, status, media_kind, created_at, updated_at)
      VALUES
        ('relay-generation', 'default-session', 'Relay', 'completed', 'image', 'now', 'now');
      INSERT INTO generation_jobs
        (id, generation_id, provider, model, status, phase, created_at, updated_at)
      VALUES
        ('relay-job', 'relay-generation', 'fal', 'model', 'completed', 'terminal', 'now', 'now');
      INSERT INTO images
        (id, generation_job_id, "index", source_kind, remote_url, content_type, created_at)
      VALUES
        ('relay-image', 'relay-job', 0, 'remote', '${remoteUrl}', 'image/png', 'now');
    `);
    server.use(http.get(remoteUrl, () => new HttpResponse(null, { status: 503 })));

    const firstFavorite = await postFavorite(new Request('http://localhost/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId: 'relay-image' }),
    }));
    expect(firstFavorite.status).toBe(503);
    expect(listFavorites({}, db).items).toEqual([]);

    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...Buffer.from('browser-relayed-image'),
    ]);
    const pin = await postPin(new Request('http://localhost/api/images/relay-image/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: pngBytes,
    }), { params: Promise.resolve({ id: 'relay-image' }) });
    expect(pin.status).toBe(204);

    const retriedFavorite = await postFavorite(new Request('http://localhost/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId: 'relay-image' }),
    }));
    expect(retriedFavorite.status).toBe(200);
    await expect(retriedFavorite.json()).resolves.toMatchObject({
      imageId: 'relay-image',
      delivery: 'managed',
      availability: 'available',
    });
    expect(listFavorites({}, db).items).toHaveLength(1);
  });
});
