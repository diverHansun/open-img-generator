import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError } from '../../src/lib/errors';
import { GET as getImage } from '../../src/app/api/images/[id]/route';
import { GET as downloadImage } from '../../src/app/api/images/[id]/download/route';

vi.mock('../../src/lib/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/lib/db')>();
  return {
    ...original,
    getImage: vi.fn(),
    getGenerationJob: vi.fn(),
  };
});

vi.mock('../../src/lib/storage', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/lib/storage')>();
  return {
    ...original,
    getReadStream: vi.fn(),
  };
});

import * as db from '../../src/lib/db';
import * as storage from '../../src/lib/storage';

describe('GET /api/images/:id', () => {
  beforeEach(() => {
    vi.mocked(db.getImage).mockReset();
    vi.mocked(db.getGenerationJob).mockReset();
    vi.mocked(storage.getReadStream).mockReset();
  });

  it('returns image stream with content type', async () => {
    vi.mocked(db.getImage).mockReturnValue({
      id: 'img-1',
      generationJobId: 'job-1',
      index: 0,
      sourceKind: 'managed',
      storagePath: '2026/07/img.png',
      remoteUrl: null,
      remoteExpiresAt: null,
      contentType: 'image/png',
      width: 1024,
      height: 1024,
      sizeBytes: 1234,
      createdAt: '2026-07-12T10:00:00.000Z',
      removedAt: null,
      removalReason: null,
    });

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    vi.mocked(storage.getReadStream).mockReturnValue(stream as unknown as ReturnType<typeof storage.getReadStream>);

    const response = await getImage(
      new Request('http://localhost:3000/api/images/img-1'),
      { params: Promise.resolve({ id: 'img-1' }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
  });

  it('returns 404 for missing image', async () => {
    vi.mocked(db.getImage).mockImplementation(() => {
      throw new NotFoundError('Image not found');
    });

    const response = await getImage(
      new Request('http://localhost:3000/api/images/missing'),
      { params: Promise.resolve({ id: 'missing' }) },
    );

    expect(response.status).toBe(404);
  });

  it('redirects remote preview and download without proxying media bytes', async () => {
    vi.mocked(db.getImage).mockReturnValue({
      id: 'remote-1', generationJobId: 'job-1', index: 0,
      sourceKind: 'remote', storagePath: null,
      remoteUrl: 'https://v3.fal.media/result.png?token=secret',
      remoteExpiresAt: null, contentType: 'image/png', width: 1024, height: 1024,
      sizeBytes: null, createdAt: '2026-07-12T10:00:00.000Z',
      removedAt: null, removalReason: null,
    });
    vi.mocked(db.getGenerationJob).mockReturnValue({
      id: 'job-1', generationId: 'gen-1', provider: 'fal',
      model: 'fal-ai/flux/schnell', status: 'completed', providerHandle: null,
      error: null, phase: 'terminal', requestSnapshot: null,
      requestSnapshotVersion: null, resultSnapshot: null, attemptCount: 0,
      retryStartedAt: null, pollLeaseUntil: null, nextPollAt: null,
      cancelRequestedAt: null, createdAt: 'now', updatedAt: 'now',
    });

    for (const response of [
      await getImage(new Request('http://localhost/api/images/remote-1'), { params: Promise.resolve({ id: 'remote-1' }) }),
      await downloadImage(new Request('http://localhost/api/images/remote-1/download'), { params: Promise.resolve({ id: 'remote-1' }) }),
    ]) {
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toContain('https://v3.fal.media/result.png');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(await response.text()).toBe('');
    }
    expect(storage.getReadStream).not.toHaveBeenCalled();
  });
});
