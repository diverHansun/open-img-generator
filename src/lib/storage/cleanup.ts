import fs from 'node:fs';
import path from 'node:path';
import {
  countRetainedFavorites,
  listGenerationJobResultSnapshots,
  listRetentionCandidates,
  listStoragePaths,
  markImageExpiredIfUnfavorited,
  type DbClient,
} from '../db';
import { db } from '../db';
import { getStorageRoot, removeStoredFile } from './index';
import { parseImageRetentionDays } from './retention-policy';

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
  };
  if (retentionDays > 0) {
    for (const image of listRetentionCandidates(
      new Date(now - retentionDays * 86_400_000).toISOString(),
      client,
    )) {
      if (options.dryRun) {
        result.expiredImages += 1;
        continue;
      }
      // The tombstone write is the linearization point. A concurrent favorite
      // wins through the DB guard; the file path is only returned to the winner.
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
      } catch {
        // A missing file is safe to reconcile; other failures remain for retry.
        if (!fs.existsSync(path.resolve(getStorageRoot(), removed.storagePath))) {
          result.deletedFiles += 1;
        } else {
          result.failures += 1;
        }
      }
    }
  }

  const referenced = new Set(listStoragePaths(client));
  const referencedStagingIds = stagedIdsFromSnapshots(
    listGenerationJobResultSnapshots(client),
  );
  for (const absolute of walkFiles(getStorageRoot())) {
    const relative = path.relative(getStorageRoot(), absolute);
    const stagingPrefix = `.staging${path.sep}`;
    if (relative.startsWith(stagingPrefix)) {
      const match = /^([0-9a-f-]{36})\.[a-z0-9]+$/i.exec(path.basename(relative));
      if (match && referencedStagingIds.has(match[1]!)) continue;
      const stat = fs.statSync(absolute);
      if (now - stat.mtimeMs < orphanGraceMs) continue;
      if (options.dryRun) {
        result.deletedOrphans += 1;
        continue;
      }
      try {
        fs.rmSync(absolute, { force: true });
        result.deletedOrphans += 1;
      } catch {
        result.failures += 1;
      }
      continue;
    }
    if (referenced.has(relative)) continue;
    const stat = fs.statSync(absolute);
    if (now - stat.mtimeMs < orphanGraceMs) continue;
    if (options.dryRun) {
      result.deletedOrphans += 1;
      continue;
    }
    try {
      fs.rmSync(absolute, { force: true });
      result.deletedOrphans += 1;
    } catch {
      result.failures += 1;
    }
  }

  return result;
}
