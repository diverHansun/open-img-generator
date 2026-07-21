import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadEnv } from 'vite';

const root = process.cwd();
Object.assign(process.env, loadEnv('development', root, ''));

const [{ db, getDatabasePath, restoreImageStorageIfMissing }, providers, storage, observability] =
  await Promise.all([
    import('../src/lib/db/index'),
    import('../src/lib/providers/index'),
    import('../src/lib/storage/index'),
    import('../src/lib/observability/safe-logger'),
  ]);

type Candidate = {
  imageId: string;
  imageIndex: number;
  provider: 'fal' | 'qwen';
  providerHandle: string;
};

const args = new Set(process.argv.slice(2));
const applyFavorites = args.has('--apply-favorites');
const pollProviders = args.has('--poll-providers');
const backupPath = path.resolve('data/app.db.pre-migrate-v4-to-v5.bak');
const currentPath = getDatabasePath();

if (!fs.existsSync(backupPath)) throw new Error('Migration backup is unavailable');

const current = new Database(currentPath);
current.pragma('foreign_keys = ON');

function restoreFavorites(): { eligible: number; restored: number } {
  current.prepare('ATTACH DATABASE ? AS recovery_backup').run(backupPath);
  try {
    const eligible = current.prepare(`
      SELECT COUNT(*) AS count
      FROM recovery_backup.favorites source
      JOIN main.images image ON image.id = source.image_id
      WHERE image.storage_path IS NULL
        AND image.removal_reason = 'storage_missing'
    `).get() as { count: number };
    if (!applyFavorites) return { eligible: eligible.count, restored: 0 };
    const result = current.prepare(`
      INSERT OR IGNORE INTO main.favorites (id, image_id, created_at)
      SELECT source.id, source.image_id, source.created_at
      FROM recovery_backup.favorites source
      JOIN main.images image ON image.id = source.image_id
      WHERE image.storage_path IS NULL
        AND image.removal_reason = 'storage_missing'
    `).run();
    return { eligible: eligible.count, restored: result.changes };
  } finally {
    current.exec('DETACH DATABASE recovery_backup');
  }
}

function candidates(): Candidate[] {
  return current.prepare(`
    SELECT image.id AS imageId, image."index" AS imageIndex,
           job.provider AS provider, job.provider_handle AS providerHandle
    FROM images image
    JOIN generation_jobs job ON job.id = image.generation_job_id
    WHERE image.storage_path IS NULL
      AND image.removal_reason = 'storage_missing'
      AND job.provider IN ('fal', 'qwen')
      AND job.provider_handle IS NOT NULL
    ORDER BY image.created_at ASC
  `).all() as Candidate[];
}

const favoriteResult = restoreFavorites();
const recoveryCandidates = candidates();
current.close();

let restoredBytes = 0;
let unavailable = 0;
let failed = 0;

if (pollProviders) {
  for (const candidate of recoveryCandidates) {
    let handle: import('../src/lib/providers/types').JobHandle;
    try {
      handle = JSON.parse(candidate.providerHandle) as typeof handle;
    } catch {
      failed += 1;
      continue;
    }
    if (handle.providerId !== candidate.provider) {
      failed += 1;
      continue;
    }
    const provider = providers.getById(candidate.provider);
    if (!provider?.poll) {
      unavailable += 1;
      continue;
    }
    observability.logSafeEvent({
      event: 'storage.recovery_attempted',
      entityId: candidate.imageId,
      provider: candidate.provider,
      method: 'provider_poll',
    });
    const result = await provider.poll(handle);
    if (result.status !== 'completed') {
      unavailable += 1;
      observability.logSafeEvent({
        event: 'storage.recovery_completed',
        entityId: candidate.imageId,
        provider: candidate.provider,
        outcome: 'unavailable',
      });
      continue;
    }
    const reference = result.images.find((image) => image.index === candidate.imageIndex);
    if (!reference) {
      unavailable += 1;
      continue;
    }
    try {
      const stored = await storage.downloadAndStore(reference.url);
      const committed = restoreImageStorageIfMissing(candidate.imageId, {
        storagePath: stored.storagePath,
        contentType: stored.contentType,
        width: reference.width,
        height: reference.height,
        sizeBytes: stored.sizeBytes,
      }, db);
      if (!committed) {
        storage.removeStoredFile(stored.storagePath);
        observability.logSafeEvent({
          event: 'storage.recovery_completed',
          entityId: candidate.imageId,
          provider: candidate.provider,
          outcome: 'conflict',
        });
        continue;
      }
      restoredBytes += 1;
      observability.logSafeEvent({
        event: 'storage.recovery_completed',
        entityId: candidate.imageId,
        provider: candidate.provider,
        outcome: 'restored',
      });
    } catch {
      failed += 1;
      observability.logSafeEvent({
        event: 'storage.recovery_completed',
        entityId: candidate.imageId,
        provider: candidate.provider,
        outcome: 'failed',
      });
    }
  }
}

console.info(JSON.stringify({
  favoritesEligible: favoriteResult.eligible,
  favoritesRestored: favoriteResult.restored,
  providerCandidates: recoveryCandidates.length,
  providerPollingEnabled: pollProviders,
  restoredBytes,
  unavailable,
  failed,
}));
