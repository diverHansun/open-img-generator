import { describe, it, expect } from 'vitest';
import { createTestDb } from '../../../../tests/helpers/db';
import { createGenerationAndJob } from './generations';
import { createImage, imageExists, getImage } from './images';

const now = '2026-07-12T10:00:00.000Z';

describe('images queries', () => {
  function seedJob(db: ReturnType<typeof createTestDb>['db']) {
    createGenerationAndJob(
      {
        id: 'gen-1',
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
  }

  it('creates and retrieves image', () => {
    const { db } = createTestDb();
    seedJob(db);
    const img = createImage(
      {
        id: 'img-1',
        jobId: 'job-1',
        index: 0,
        storagePath: '2026/07/img.png',
        contentType: 'image/png',
        width: 1024,
        height: 1024,
        sizeBytes: 1234,
        createdAt: now,
      },
      db,
    );
    expect(img.storagePath).toBe('2026/07/img.png');
    const found = getImage('img-1', db);
    expect(found.id).toBe('img-1');
  });

  it('detects existing image by job and index', () => {
    const { db } = createTestDb();
    seedJob(db);
    createImage(
      {
        id: 'img-1',
        jobId: 'job-1',
        index: 0,
        storagePath: 'a.png',
        contentType: 'image/png',
        width: null,
        height: null,
        sizeBytes: 100,
        createdAt: now,
      },
      db,
    );
    expect(imageExists('job-1', 0, db)).toBe(true);
    expect(imageExists('job-1', 1, db)).toBe(false);
    expect(imageExists('job-2', 0, db)).toBe(false);
  });

  it('throws when image not found', () => {
    const { db } = createTestDb();
    expect(() => getImage('missing', db)).toThrow('Image not found: missing');
  });
});
