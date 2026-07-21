import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError } from '../../src/lib/errors';
import { GET as getImage } from '../../src/app/api/images/[id]/route';

vi.mock('../../src/lib/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/lib/db')>();
  return {
    ...original,
    getImage: vi.fn(),
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
    vi.mocked(storage.getReadStream).mockReset();
  });

  it('returns image stream with content type', async () => {
    vi.mocked(db.getImage).mockReturnValue({
      id: 'img-1',
      generationJobId: 'job-1',
      index: 0,
      storagePath: '2026/07/img.png',
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
});
