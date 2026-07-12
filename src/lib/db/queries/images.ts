import { eq, and } from 'drizzle-orm';
import { db, type DbClient } from '../client';
import { images } from '../schema';
import type { Image } from '../schema';

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
    throw new Error(`Image not found: ${id}`);
  }
  return row;
}
