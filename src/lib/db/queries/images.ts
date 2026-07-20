import { and, eq, inArray, isNull, lt, notExists } from 'drizzle-orm';
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
  return client.select({ storagePath: images.storagePath }).from(images).all().map((row) => row.storagePath);
}

export function listRetentionCandidates(
  cutoff: string,
  client: DbClient = db,
): Image[] {
  return client
    .select({ image: images })
    .from(images)
    .leftJoin(favorites, eq(favorites.imageId, images.id))
    .where(and(lt(images.createdAt, cutoff), isNull(favorites.id)))
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

export function deleteImageIfUnfavorited(
  id: string,
  client: DbClient = db,
): boolean {
  const result = client
    .delete(images)
    .where(
      and(
        eq(images.id, id),
        notExists(
          client
            .select({ id: favorites.id })
            .from(favorites)
            .where(eq(favorites.imageId, images.id)),
        ),
      ),
    )
    .run();
  return result.changes > 0;
}
