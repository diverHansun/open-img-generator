import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  notExists,
} from 'drizzle-orm';
import { db, type DbClient } from '../client';
import { favorites, images } from '../schema';
import type { Image } from '../schema';
import { NotFoundError } from '../../errors';

export type CreateImageParams = {
  id: string;
  jobId: string;
  index: number;
  storagePath: string;
  contentType: string;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  createdAt: string;
};

export const IMAGE_REMOVAL_REASONS = [
  'retention_expired',
  'user_deleted',
  'storage_missing',
] as const;

export type ImageRemovalReason = (typeof IMAGE_REMOVAL_REASONS)[number];
export type ImageAvailability = 'available' | ImageRemovalReason;

export type RemovedImageResult = {
  storagePath: string | null;
  availability: ImageAvailability;
  removedAt: string | null;
};

export function getImageAvailability(
  image: Pick<Image, 'storagePath' | 'removedAt' | 'removalReason'>,
): ImageAvailability {
  if (image.storagePath !== null) return 'available';
  if (
    image.removalReason === 'retention_expired' ||
    image.removalReason === 'user_deleted' ||
    image.removalReason === 'storage_missing'
  ) {
    return image.removalReason;
  }
  throw new Error('Image availability invariant is invalid');
}

export function createImage(
  params: CreateImageParams,
  client: DbClient = db,
): Image {
  client
    .insert(images)
    .values({
      id: params.id,
      generationJobId: params.jobId,
      index: params.index,
      storagePath: params.storagePath,
      contentType: params.contentType,
      width: params.width,
      height: params.height,
      sizeBytes: params.sizeBytes,
      createdAt: params.createdAt,
    })
    .run();
  return getImage(params.id, client);
}

export function createImageIfAbsent(
  params: CreateImageParams,
  client: DbClient = db,
): boolean {
  const result = client
    .insert(images)
    .values({
      id: params.id,
      generationJobId: params.jobId,
      index: params.index,
      storagePath: params.storagePath,
      contentType: params.contentType,
      width: params.width,
      height: params.height,
      sizeBytes: params.sizeBytes,
      createdAt: params.createdAt,
    })
    .onConflictDoNothing()
    .run();
  return result.changes > 0;
}

/**
 * Removes exactly one image inserted by a losing lifecycle attempt. This is
 * intentionally keyed by both image and job so cancellation cleanup can never
 * remove a row belonging to another job; favorites cascade with the image.
 */
export function deleteImageForJob(
  id: string,
  jobId: string,
  client: DbClient = db,
): boolean {
  const result = client
    .delete(images)
    .where(and(eq(images.id, id), eq(images.generationJobId, jobId)))
    .run();
  return result.changes > 0;
}

export function imageExists(
  jobId: string,
  index: number,
  client: DbClient = db,
): boolean {
  const row = client
    .select({ id: images.id })
    .from(images)
    .where(and(eq(images.generationJobId, jobId), eq(images.index, index)))
    .get();
  return row !== undefined;
}

export function getImage(id: string, client: DbClient = db): Image {
  const row = client.select().from(images).where(eq(images.id, id)).get();
  if (!row) {
    throw new NotFoundError(`Image not found: ${id}`);
  }
  return row;
}

export function listFavoriteImageIds(
  imageIds: string[],
  client: DbClient = db,
): Set<string> {
  if (imageIds.length === 0) return new Set();
  return new Set(
    client
      .select({ imageId: favorites.imageId })
      .from(favorites)
      .where(inArray(favorites.imageId, imageIds))
      .all()
      .map((row) => row.imageId),
  );
}

export function listStoragePaths(client: DbClient = db): string[] {
  return client
    .select({ storagePath: images.storagePath })
    .from(images)
    .where(isNotNull(images.storagePath))
    .all()
    .map((row) => row.storagePath!);
}

export function listRetentionCandidates(
  cutoff: string,
  client: DbClient = db,
): Image[] {
  return client
    .select({ image: images })
    .from(images)
    .leftJoin(favorites, eq(favorites.imageId, images.id))
    .where(
      and(
        lt(images.createdAt, cutoff),
        isNotNull(images.storagePath),
        isNull(images.removedAt),
        isNull(favorites.id),
      ),
    )
    .all()
    .map((row) => row.image);
}

export function countRetainedFavorites(
  cutoff: string,
  client: DbClient = db,
): number {
  return client
    .select({ id: images.id })
    .from(images)
    .innerJoin(favorites, eq(favorites.imageId, images.id))
    .where(lt(images.createdAt, cutoff))
    .all().length;
}

/**
 * Atomically replaces a live file reference with a retention tombstone. A
 * concurrently-created favorite wins through the NOT EXISTS guard.
 */
export function markImageExpiredIfUnfavorited(
  id: string,
  removedAt: string,
  client: DbClient = db,
): RemovedImageResult | null {
  return client.transaction(
    (tx) => {
      const current = tx
        .select()
        .from(images)
        .where(eq(images.id, id))
        .get();
      if (!current || current.storagePath === null) return null;
      const result = tx
        .update(images)
        .set({
          storagePath: null,
          removedAt,
          removalReason: 'retention_expired',
        })
        .where(
          and(
            eq(images.id, id),
            isNotNull(images.storagePath),
            notExists(
              tx
                .select({ id: favorites.id })
                .from(favorites)
                .where(eq(favorites.imageId, images.id)),
            ),
          ),
        )
        .run();
      return result.changes > 0
        ? {
            storagePath: current.storagePath,
            availability: 'retention_expired',
            removedAt,
          }
        : null;
    },
    { behavior: 'immediate' },
  );
}

/** Explicit image deletion wins over favorite state but preserves history. */
export function markImageUserDeleted(
  id: string,
  removedAt: string,
  client: DbClient = db,
): RemovedImageResult | undefined {
  return client.transaction(
    (tx) => {
      const current = tx.select().from(images).where(eq(images.id, id)).get();
      if (!current) return undefined;
      if (current.storagePath === null) {
        return {
          storagePath: null,
          availability: getImageAvailability(current),
          removedAt: current.removedAt,
        };
      }
      tx.delete(favorites).where(eq(favorites.imageId, id)).run();
      const updated = tx
        .update(images)
        .set({
          storagePath: null,
          removedAt,
          removalReason: 'user_deleted',
        })
        .where(and(eq(images.id, id), isNotNull(images.storagePath)))
        .run();
      if (updated.changes === 0) {
        const winner = tx.select().from(images).where(eq(images.id, id)).get();
        return winner
          ? {
              storagePath: null,
              availability: getImageAvailability(winner),
              removedAt: winner.removedAt,
            }
          : undefined;
      }
      return {
        storagePath: current.storagePath,
        availability: 'user_deleted',
        removedAt,
      };
    },
    { behavior: 'immediate' },
  );
}

/** Reconciles a DB row whose managed file disappeared outside the app. */
export function markImageStorageMissing(
  id: string,
  removedAt: string,
  client: DbClient = db,
): RemovedImageResult | undefined {
  return client.transaction(
    (tx) => {
      const current = tx.select().from(images).where(eq(images.id, id)).get();
      if (!current) return undefined;
      if (current.storagePath === null) {
        return {
          storagePath: null,
          availability: getImageAvailability(current),
          removedAt: current.removedAt,
        };
      }
      tx.delete(favorites).where(eq(favorites.imageId, id)).run();
      tx.update(images)
        .set({
          storagePath: null,
          removedAt,
          removalReason: 'storage_missing',
        })
        .where(and(eq(images.id, id), isNotNull(images.storagePath)))
        .run();
      return {
        storagePath: current.storagePath,
        availability: 'storage_missing',
        removedAt,
      };
    },
    { behavior: 'immediate' },
  );
}
