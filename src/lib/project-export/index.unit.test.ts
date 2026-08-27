import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createTestDb } from '../../../tests/helpers/db';
import { createGenerationAndJob } from '../db';
import { createImage } from '../db/queries/images';

import { buildProjectExportSnapshotForTest } from './index';

const now = '2026-07-22T10:00:00.000Z';

describe('project export snapshot', () => {
  const originalStorageDir = process.env.LOCAL_STORAGE_DIR;
  let storageDir: string;

  beforeEach(() => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-export-test-'));
    process.env.LOCAL_STORAGE_DIR = storageDir;
  });

  afterEach(() => {
    if (originalStorageDir === undefined) delete process.env.LOCAL_STORAGE_DIR;
    else process.env.LOCAL_STORAGE_DIR = originalStorageDir;
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  it('includes completed image history and excludes in-progress generations', () => {
    const { db } = createTestDb();
    createGenerationAndJob(
      {
        id: 'generation-completed',
        sessionId: 'default-session',
        prompt: 'Completed image prompt',
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'job-completed',
        generationId: 'generation-completed',
        provider: 'fal',
        model: 'fal-ai/flux/schnell',
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      },
      db,
    );
    createGenerationAndJob(
      {
        id: 'generation-pending',
        sessionId: 'default-session',
        prompt: 'This must not be exported',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'job-pending',
        generationId: 'generation-pending',
        provider: 'fal',
        model: 'fal-ai/flux/schnell',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      },
      db,
    );
    fs.mkdirSync(path.join(storageDir, '2026', '07'), { recursive: true });
    fs.writeFileSync(path.join(storageDir, '2026', '07', 'completed.png'), 'png');
    createImage(
      {
        id: 'image-completed',
        jobId: 'job-completed',
        index: 0,
        storagePath: '2026/07/completed.png',
        contentType: 'image/png',
        width: 1024,
        height: 1024,
        sizeBytes: 3,
        createdAt: now,
      },
      db,
    );

    const snapshot = buildProjectExportSnapshotForTest('default-project', db);
    const [session] = snapshot.sessions;

    expect(session?.generations).toHaveLength(1);
    expect(session?.generations[0]).toMatchObject({
      id: 'generation-completed',
      prompt: 'Completed image prompt',
      images: [
        {
          id: 'image-completed',
          availability: 'exported',
          file: expect.stringContaining('/image-01-image-completed.png'),
        },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toContain('This must not be exported');
  });
});
