import { describe, it, expect } from 'vitest';
import { createTestDb } from '../../../../tests/helpers/db';
import { favorites } from '../schema';
import { createGenerationAndJob } from './generations';
import {
  createImage,
  getImage,
  imageExists,
  listFavoriteImageIds,
} from './images';
import { NotFoundError } from '../../errors';

const now = '2026-07-12T10:00:00.000Z';

describe('images queries', () => {
  function seedJob(db: ReturnType<typeof createTestDb>['db']) {
    createGenerationAndJob(
      {
        id: 'gen-1',
        sessionId: 'default-session',
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

  it('throws NotFoundError when image not found', () => {
    const { db } = createTestDb();
    expect(() => getImage('missing', db)).toThrow('Image not found: missing');
    try {
      getImage('missing', db);
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoundError);
    }
  });

  it('returns favorite membership for a batch of image ids', () => {
    const { db } = createTestDb();
    seedJob(db);
    for (const [index, id] of ['img-1', 'img-2'].entries()) {
      createImage(
        {
          id,
          jobId: 'job-1',
          index,
          storagePath: `${id}.png`,
          contentType: 'image/png',
          width: 1,
          height: 1,
          sizeBytes: 1,
          createdAt: now,
        },
        db,
      );
    }
    db.insert(favorites)
      .values({ id: 'favorite-1', imageId: 'img-2', createdAt: now })
      .run();

    expect([...listFavoriteImageIds(['img-1', 'img-2'], db)]).toEqual(['img-2']);
    expect(listFavoriteImageIds([], db).size).toBe(0);
  });
});
