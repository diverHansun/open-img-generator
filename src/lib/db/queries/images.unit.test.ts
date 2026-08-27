import { describe, it, expect } from 'vitest';
import { createTestDb } from '../../../../tests/helpers/db';
import { favorites } from '../schema';
import { createGenerationAndJob } from './generations';
import {
  createImage,
  createRemoteImageIfAbsent,
  getImage,
  imageExists,
  listFavoriteImageIds,
  getImageAvailability,
  markImageExpiredIfUnfavorited,
  markImageStorageMissing,
  markImageUserDeleted,
  markRemoteImageExpired,
  restoreImageStorageIfMissing,
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

  it('stores a remote image without a local path and preserves favorite expiry tombstones', () => {
    const { db } = createTestDb();
    seedJob(db);
    expect(createRemoteImageIfAbsent({
      id: 'remote-1',
      jobId: 'job-1',
      index: 0,
      remoteUrl: 'https://v3.fal.media/result.png?token=secret',
      remoteExpiresAt: '2026-07-13T10:00:00.000Z',
      contentType: 'image/png',
      width: 1024,
      height: 1024,
      createdAt: now,
    }, db)).toBe(true);
    const image = getImage('remote-1', db);
    expect(image).toMatchObject({
      sourceKind: 'remote',
      storagePath: null,
      sizeBytes: null,
    });
    db.insert(favorites).values({ id: 'favorite-1', imageId: image.id, createdAt: now }).run();
    expect(markRemoteImageExpired(image.id, now, db)).toBe(true);
    expect(getImageAvailability(getImage(image.id, db))).toBe('remote_expired');
    expect(listFavoriteImageIds([image.id], db)).toEqual(new Set([image.id]));
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

  it('preserves a retention tombstone and lets a favorite win the guard', () => {
    const { db } = createTestDb();
    seedJob(db);
    createImage(
      {
        id: 'img-1',
        jobId: 'job-1',
        index: 0,
        storagePath: 'img.png',
        contentType: 'image/png',
        width: null,
        height: null,
        sizeBytes: 1,
        createdAt: now,
      },
      db,
    );
    db.insert(favorites)
      .values({ id: 'favorite-1', imageId: 'img-1', createdAt: now })
      .run();
    expect(markImageExpiredIfUnfavorited('img-1', now, db)).toBeNull();
    db.delete(favorites).run();
    expect(markImageExpiredIfUnfavorited('img-1', now, db)).toEqual({
      storagePath: 'img.png',
      availability: 'retention_expired',
      removedAt: now,
    });
    expect(getImageAvailability(getImage('img-1', db))).toBe(
      'retention_expired',
    );
  });

  it('explicit deletion removes favorite but keeps an idempotent tombstone', () => {
    const { db } = createTestDb();
    seedJob(db);
    createImage(
      {
        id: 'img-1',
        jobId: 'job-1',
        index: 0,
        storagePath: 'img.png',
        contentType: 'image/png',
        width: null,
        height: null,
        sizeBytes: 1,
        createdAt: now,
      },
      db,
    );
    db.insert(favorites)
      .values({ id: 'favorite-1', imageId: 'img-1', createdAt: now })
      .run();
    expect(markImageUserDeleted('img-1', now, db)).toMatchObject({
      storagePath: 'img.png',
      availability: 'user_deleted',
    });
    expect(listFavoriteImageIds(['img-1'], db).size).toBe(0);
    expect(markImageUserDeleted('img-1', 'later', db)).toEqual({
      storagePath: null,
      availability: 'user_deleted',
      removedAt: now,
    });
  });

  it('preserves favorite intent when the managed file is missing', () => {
    const { db } = createTestDb();
    seedJob(db);
    createImage(
      {
        id: 'img-1',
        jobId: 'job-1',
        index: 0,
        storagePath: 'img.png',
        contentType: 'image/png',
        width: null,
        height: null,
        sizeBytes: 1,
        createdAt: now,
      },
      db,
    );
    db.insert(favorites)
      .values({ id: 'favorite-1', imageId: 'img-1', createdAt: now })
      .run();

    expect(markImageStorageMissing('img-1', now, db)).toMatchObject({
      storagePath: 'img.png',
      availability: 'storage_missing',
    });
    expect(listFavoriteImageIds(['img-1'], db)).toEqual(new Set(['img-1']));
    expect(getImageAvailability(getImage('img-1', db))).toBe('storage_missing');
    expect(markImageUserDeleted('img-1', 'later', db)).toEqual({
      storagePath: null,
      availability: 'user_deleted',
      removedAt: 'later',
    });
    expect(listFavoriteImageIds(['img-1'], db).size).toBe(0);
  });

  it('restores bytes only from a storage-missing tombstone', () => {
    const { db } = createTestDb();
    seedJob(db);
    createImage(
      {
        id: 'img-1',
        jobId: 'job-1',
        index: 0,
        storagePath: 'old.png',
        contentType: 'image/png',
        width: null,
        height: null,
        sizeBytes: 1,
        createdAt: now,
      },
      db,
    );
    markImageStorageMissing('img-1', now, db);
    expect(restoreImageStorageIfMissing('img-1', {
      storagePath: 'restored.png',
      contentType: 'image/png',
      width: 1024,
      height: 1024,
      sizeBytes: 42,
    }, db)).toBe(true);
    expect(getImage('img-1', db)).toMatchObject({
      storagePath: 'restored.png',
      removedAt: null,
      removalReason: null,
      sizeBytes: 42,
    });
    expect(restoreImageStorageIfMissing('img-1', {
      storagePath: 'second.png',
      contentType: 'image/png',
      width: null,
      height: null,
      sizeBytes: 2,
    }, db)).toBe(false);
  });
});
