import fs from 'node:fs';
import path from 'node:path';
import {
  countRetainedFavorites,
  listGenerationJobResultSnapshots,
  listRetentionCandidates,
  listStoragePaths,
  listVideoStoragePaths,
  markImageExpiredIfUnfavorited,
  type DbClient,
} from '../db';
import { db } from '../db';
import { getStorageRoot, removeStoredFile } from './index';
import { parseImageRetentionDays } from './retention-policy';
import {
  acquireCleanupLock,
  isStorageInternalPath,
  storagePathHash,
  verifyStorageOwnership,
} from './ownership';
import { logSafeEvent } from '../observability/safe-logger';

export type CleanupOptions = {
  db?: DbClient;
  retentionDays?: number;
  orphanGraceMs?: number;
  dryRun?: boolean;
};

export type CleanupResult = {
  retainedFavorites: number;
  expiredImages: number;
  deletedFiles: number;
  deletedOrphans: number;
  failures: number;
  skipped: boolean;
  skipReason?: 'ownership' | 'locked';
};

function walkFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  visit(root);
  return files;
}

function stagedIdsFromSnapshots(snapshots: string[]): Set<string> {
  const ids = new Set<string>();
  for (const snapshot of snapshots) {
    try {
      const parsed = JSON.parse(snapshot) as unknown;
      if (!Array.isArray(parsed)) continue;
      for (const value of parsed) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const reference = (value as Record<string, unknown>).url;
        if (typeof reference !== 'string') continue;
        const match = /^staging:([0-9a-f-]{36})$/i.exec(reference);
        if (match) ids.add(match[1]!);
      }
    } catch {
      // Invalid snapshots are handled by lifecycle; cleanup never logs content.
    }
  }
  return ids;
}

export function cleanupStoredImages(options: CleanupOptions = {}): CleanupResult {
  const client = options.db ?? db;
  const retentionDays = options.retentionDays ?? parseImageRetentionDays().days;
  const orphanGraceMs = options.orphanGraceMs ?? Number(process.env.IMAGE_ORPHAN_GRACE_MS ?? 3_600_000);
  const now = Date.now();
  const runId = crypto.randomUUID();
  const result: CleanupResult = {
    retainedFavorites: retentionDays > 0
      ? countRetainedFavorites(
          new Date(now - retentionDays * 86_400_000).toISOString(),
          client,
        )
      : 0,
    expiredImages: 0,
    deletedFiles: 0,
    deletedOrphans: 0,
    failures: 0,
    skipped: false,
  };
  const root = getStorageRoot();
  try {
    verifyStorageOwnership(root, client);
  } catch {
    result.skipped = true;
    result.skipReason = 'ownership';
    logSafeEvent({ event: 'storage.cleanup_skipped', runId, reason: 'ownership' });
    return result;
  }
  const lock = acquireCleanupLock(root);
  if (!lock) {
    result.skipped = true;
    result.skipReason = 'locked';
    logSafeEvent({ event: 'storage.cleanup_skipped', runId, reason: 'locked' });
    return result;
  }
  const referenced = new Set([
    ...listStoragePaths(client),
    ...listVideoStoragePaths(client),
  ]);
  logSafeEvent({
    event: 'storage.cleanup_started',
    runId,
    referencedFiles: referenced.size,
  });
  try {
    if (retentionDays > 0) {
      for (const image of listRetentionCandidates(
        new Date(now - retentionDays * 86_400_000).toISOString(),
        client,
      )) {
        if (options.dryRun) {
          result.expiredImages += 1;
          continue;
        }
        const removed = markImageExpiredIfUnfavorited(
          image.id,
          new Date(now).toISOString(),
          client,
        );
        if (!removed?.storagePath) continue;
        result.expiredImages += 1;
        try {
          removeStoredFile(removed.storagePath);
          result.deletedFiles += 1;
          logSafeEvent({
            event: 'storage.file_removed',
            runId,
            mediaKind: 'image',
            entityId: image.id,
            reason: 'retention',
            pathHash: storagePathHash(removed.storagePath),
          });
        } catch {
          if (!fs.existsSync(path.resolve(root, removed.storagePath))) {
            result.deletedFiles += 1;
          } else {
            result.failures += 1;
            logSafeEvent({
              event: 'storage.file_remove_failed',
              runId,
              entityId: image.id,
              code: 'REMOVE_FAILED',
            });
          }
        }
      }
    }

    const referencedStagingIds = stagedIdsFromSnapshots(
      listGenerationJobResultSnapshots(client),
    );
    for (const absolute of walkFiles(root)) {
      const relative = path.relative(root, absolute);
      if (isStorageInternalPath(relative)) continue;
      const stagingPrefix = `.staging${path.sep}`;
      if (relative.startsWith(stagingPrefix)) {
        const match = /^([0-9a-f-]{36})\.[a-z0-9]+$/i.exec(path.basename(relative));
        if (match && referencedStagingIds.has(match[1]!)) continue;
      } else if (referenced.has(relative)) {
        continue;
      }
      const stat = fs.statSync(absolute);
      if (now - stat.mtimeMs < orphanGraceMs) continue;
      if (options.dryRun) {
        result.deletedOrphans += 1;
        continue;
      }
      const entityId = storagePathHash(relative);
      try {
        fs.rmSync(absolute, { force: true });
        result.deletedOrphans += 1;
        logSafeEvent({
          event: 'storage.file_removed',
          runId,
          mediaKind: relative.startsWith(stagingPrefix)
            ? 'staging'
            : relative.endsWith('.mp4') ? 'video' : 'orphan',
          entityId,
          reason: 'orphan',
          pathHash: entityId,
        });
      } catch {
        result.failures += 1;
        logSafeEvent({
          event: 'storage.file_remove_failed',
          runId,
          entityId,
          code: 'REMOVE_FAILED',
        });
      }
    }
    return result;
  } finally {
    lock.release();
    logSafeEvent({
      event: 'storage.cleanup_completed',
      runId,
      expiredImages: result.expiredImages,
      deletedFiles: result.deletedFiles,
      deletedOrphans: result.deletedOrphans,
      failures: result.failures,
    });
  }
}
