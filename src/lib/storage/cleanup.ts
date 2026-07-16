import fs from 'node:fs';
import path from 'node:path';
import { countRetainedFavorites, deleteImageIfUnfavorited, listRetentionCandidates, listStoragePaths, type DbClient } from '../db';
import { db } from '../db';
import { getStorageRoot, removeStoredFile } from './index';

export type CleanupOptions = {
  db?: DbClient;
  retentionDays?: number;
  orphanGraceMs?: number;
  dryRun?: boolean;
};

export type CleanupResult = {
  retainedFavorites: number;
  deletedImages: number;
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

export function cleanupStoredImages(options: CleanupOptions = {}): CleanupResult {
  const client = options.db ?? db;
  const retentionDays = options.retentionDays ?? Number(process.env.IMAGE_RETENTION_DAYS ?? 30);
  const orphanGraceMs = options.orphanGraceMs ?? Number(process.env.IMAGE_ORPHAN_GRACE_MS ?? 3_600_000);
  const now = Date.now();
  const result: CleanupResult = {
    retainedFavorites: retentionDays > 0
      ? countRetainedFavorites(
          new Date(now - retentionDays * 86_400_000).toISOString(),
          client,
        )
      : 0,
    deletedImages: 0,
    deletedOrphans: 0,
    failures: 0,
  };
  if (retentionDays > 0) {
    for (const image of listRetentionCandidates(
      new Date(now - retentionDays * 86_400_000).toISOString(),
      client,
    )) {
      if (options.dryRun) {
        result.deletedImages += 1;
        continue;
      }
      // Delete the DB row first with a favorites guard. If a user favorites
      // concurrently, this returns false and we never remove its file.
      if (!deleteImageIfUnfavorited(image.id, client)) continue;
      try {
        removeStoredFile(image.storagePath);
        result.deletedImages += 1;
      } catch {
        // A missing file is safe to reconcile; other failures remain for retry.
        if (!fs.existsSync(path.resolve(getStorageRoot(), image.storagePath))) {
          result.deletedImages += 1;
        } else {
          result.failures += 1;
        }
      }
    }
  }

  const referenced = new Set(listStoragePaths(client));
  for (const absolute of walkFiles(getStorageRoot())) {
    const relative = path.relative(getStorageRoot(), absolute);
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
