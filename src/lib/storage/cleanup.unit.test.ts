import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestDb } from '../../../tests/helpers/db';
import { createGenerationAndJob } from '../db/queries/generations';
import { createImage } from '../db/queries/images';
import { favorites, images } from '../db/schema';
import { cleanupStoredImages } from './cleanup';

const oldDate = '2020-01-01T00:00:00.000Z';

describe('stored image cleanup', () => {
  const originalStorage = process.env.LOCAL_STORAGE_DIR;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-cleanup-test-'));
    process.env.LOCAL_STORAGE_DIR = tempDir;
  });

  afterEach(() => {
    if (originalStorage === undefined) delete process.env.LOCAL_STORAGE_DIR;
    else process.env.LOCAL_STORAGE_DIR = originalStorage;
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

    expect(result.deletedImages).toBe(2);
    expect(result.failures).toBe(0);
    expect(fs.existsSync(existingPath)).toBe(false);
    expect(db.select().from(images).all()).toHaveLength(0);
  });

  it('retains favorites and reports the retained count', () => {
    const { db } = createTestDb();
    const favoritePath = writeFile('2020/favorite.png');
    seedImage(db, 'img-favorite', '2020/favorite.png', true);

    const result = cleanupStoredImages({ db, retentionDays: 1, orphanGraceMs: 0 });

    expect(result.retainedFavorites).toBe(1);
    expect(result.deletedImages).toBe(0);
    expect(fs.existsSync(favoritePath)).toBe(true);
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
});
