import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestDb } from '../../../tests/helpers/db';
import { createGenerationAndJob } from '../db/queries/generations';
import { createImage } from '../db/queries/images';
import { favorites, images } from '../db/schema';
import { cleanupStoredImages } from './cleanup';
import { verifyStorageOwnership } from './ownership';
import { createVideoIfAbsent } from '../db/queries/videos';

const oldDate = '2020-01-01T00:00:00.000Z';

describe('stored image cleanup', () => {
  const originalStorage = process.env.LOCAL_STORAGE_DIR;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-cleanup-test-'));
    process.env.LOCAL_STORAGE_DIR = tempDir;
    verifyStorageOwnership(tempDir);
  });

  afterEach(() => {
    if (originalStorage === undefined) delete process.env.LOCAL_STORAGE_DIR;
    else process.env.LOCAL_STORAGE_DIR = originalStorage;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function seedImage(
    db: ReturnType<typeof createTestDb>['db'],
    id: string,
    storagePath: string,
    favorite = false,
  ) {
    createGenerationAndJob(
      {
        id: `gen-${id}`,
        sessionId: 'default-session',
        prompt: 'cleanup test',
        status: 'completed',
        createdAt: oldDate,
        updatedAt: oldDate,
      },
      {
        id: `job-${id}`,
        generationId: `gen-${id}`,
        provider: 'fal',
        model: 'fal-ai/flux/schnell',
        status: 'completed',
        createdAt: oldDate,
        updatedAt: oldDate,
      },
      db,
    );
    createImage(
      {
        id,
        jobId: `job-${id}`,
        index: 0,
        storagePath,
        contentType: 'image/png',
        width: null,
        height: null,
        sizeBytes: 4,
        createdAt: oldDate,
      },
      db,
    );
    if (favorite) {
      db.insert(favorites).values({ id: `favorite-${id}`, imageId: id, createdAt: oldDate }).run();
    }
  }

  function writeFile(storagePath: string, contents = 'data') {
    const absolute = path.join(tempDir, storagePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, contents);
    return absolute;
  }

  it('deletes old non-favorites and reconciles missing files', () => {
    const { db } = createTestDb();
    const existingPath = writeFile('2020/old.png');
    seedImage(db, 'img-old', '2020/old.png');
    seedImage(db, 'img-missing', '2020/missing.png');

    const result = cleanupStoredImages({ db, retentionDays: 1, orphanGraceMs: 0 });

    expect(result.expiredImages).toBe(2);
    expect(result.deletedFiles).toBe(2);
    expect(result.failures).toBe(0);
    expect(fs.existsSync(existingPath)).toBe(false);
    expect(db.select().from(images).all()).toEqual([
      expect.objectContaining({
        id: 'img-old',
        storagePath: null,
        removalReason: 'retention_expired',
      }),
      expect.objectContaining({
        id: 'img-missing',
        storagePath: null,
        removalReason: 'retention_expired',
      }),
    ]);
  });

  it('retains favorites and reports the retained count', () => {
    const { db } = createTestDb();
    const favoritePath = writeFile('2020/favorite.png');
    seedImage(db, 'img-favorite', '2020/favorite.png', true);

    const result = cleanupStoredImages({ db, retentionDays: 1, orphanGraceMs: 0 });

    expect(result.retainedFavorites).toBe(1);
    expect(result.expiredImages).toBe(0);
    expect(fs.existsSync(favoritePath)).toBe(true);
  });

  it('keeps media referenced by a legacy Windows backslash path', () => {
    const { db } = createTestDb();
    const legacyPath = writeFile('2020/legacy.png');
    seedImage(db, 'img-legacy-windows', '2020\\legacy.png');

    const result = cleanupStoredImages({ db, retentionDays: 0, orphanGraceMs: 0 });

    expect(result.deletedOrphans).toBe(0);
    expect(fs.existsSync(legacyPath)).toBe(true);
  });

  it('supports dry-run and removes only aged orphan files', () => {
    const { db } = createTestDb();
    const dryRunPath = writeFile('orphan/dry-run.png');
    const oldOrphan = writeFile('orphan/old.png');
    const freshOrphan = writeFile('orphan/fresh.png');
    const oldTimestamp = new Date(Date.now() - 86_400_000);
    fs.utimesSync(oldOrphan, oldTimestamp, oldTimestamp);

    const dryRun = cleanupStoredImages({ db, retentionDays: 0, orphanGraceMs: 60_000, dryRun: true });
    expect(dryRun.deletedOrphans).toBe(1);
    expect(fs.existsSync(dryRunPath)).toBe(true);
    expect(fs.existsSync(oldOrphan)).toBe(true);
    expect(fs.existsSync(freshOrphan)).toBe(true);

    const actual = cleanupStoredImages({ db, retentionDays: 0, orphanGraceMs: 60_000 });
    expect(actual.deletedOrphans).toBe(1);
    expect(fs.existsSync(oldOrphan)).toBe(false);
    expect(fs.existsSync(freshOrphan)).toBe(true);
  });

  it('keeps an aged staged file while a durable result snapshot references it', () => {
    const { db } = createTestDb();
    const stagingId = '33333333-3333-4333-8333-333333333333';
    const stagedPath = writeFile(`.staging/${stagingId}.png`);
    const stalePath = writeFile('.staging/44444444-4444-4444-8444-444444444444.png');
    const oldTimestamp = new Date(Date.now() - 86_400_000);
    fs.utimesSync(stagedPath, oldTimestamp, oldTimestamp);
    fs.utimesSync(stalePath, oldTimestamp, oldTimestamp);
    createGenerationAndJob(
      {
        id: 'gen-staged',
        sessionId: 'default-session',
        prompt: 'staged cleanup test',
        status: 'running',
        createdAt: oldDate,
        updatedAt: oldDate,
      },
      {
        id: 'job-staged',
        generationId: 'gen-staged',
        provider: 'zenmux',
        model: 'openai/gpt-image-2',
        status: 'running',
        phase: 'storing',
        resultSnapshot: JSON.stringify([{
          url: `staging:${stagingId}`,
          width: null,
          height: null,
          contentType: 'image/png',
          index: 0,
        }]),
        createdAt: oldDate,
        updatedAt: oldDate,
      },
      db,
    );

    const result = cleanupStoredImages({ db, retentionDays: 0, orphanGraceMs: 0 });
    expect(result.deletedOrphans).toBe(1);
    expect(fs.existsSync(stagedPath)).toBe(true);
    expect(fs.existsSync(stalePath)).toBe(false);
  });

  it('keeps an aged video file referenced by the videos table', () => {
    const { db } = createTestDb();
    const videoPath = writeFile('2026/07/result.mp4');
    const oldTimestamp = new Date(Date.now() - 86_400_000);
    fs.utimesSync(videoPath, oldTimestamp, oldTimestamp);
    createGenerationAndJob(
      {
        id: 'gen-video',
        sessionId: 'default-session',
        prompt: 'video cleanup test',
        status: 'completed',
        mediaKind: 'video',
        createdAt: oldDate,
        updatedAt: oldDate,
      },
      {
        id: 'job-video',
        generationId: 'gen-video',
        provider: 'doubao',
        model: 'seedance',
        status: 'completed',
        createdAt: oldDate,
        updatedAt: oldDate,
      },
      db,
    );
    createVideoIfAbsent(
      {
        id: 'video-1',
        jobId: 'job-video',
        index: 0,
        storagePath: '2026/07/result.mp4',
        contentType: 'video/mp4',
        width: 1280,
        height: 720,
        durationSeconds: 5,
        sizeBytes: 4,
        createdAt: oldDate,
      },
      db,
    );

    const result = cleanupStoredImages({ db, retentionDays: 0, orphanGraceMs: 0 });
    expect(result.deletedOrphans).toBe(0);
    expect(fs.existsSync(videoPath)).toBe(true);
  });

  it('refuses cleanup when another database points at the owned root', () => {
    const { db } = createTestDb();
    const orphan = writeFile('orphan.png');
    const oldTimestamp = new Date(Date.now() - 86_400_000);
    fs.utimesSync(orphan, oldTimestamp, oldTimestamp);
    process.env.DATABASE_URL = `file:${path.join(tempDir, 'different.sqlite')}`;

    const result = cleanupStoredImages({ db, retentionDays: 0, orphanGraceMs: 0 });
    expect(result).toMatchObject({ skipped: true, skipReason: 'ownership' });
    expect(fs.existsSync(orphan)).toBe(true);
  });
});
