import { and, eq } from 'drizzle-orm';
import { db, type DbClient } from '../client';
import { videos } from '../schema';
import type { Video } from '../schema';
import { NotFoundError } from '../../errors';

export type CreateVideoParams = {
  id: string;
  jobId: string;
  index: number;
  storagePath: string;
  contentType: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  sizeBytes: number;
  createdAt: string;
};

export function createVideoIfAbsent(
  params: CreateVideoParams,
  client: DbClient = db,
): boolean {
  return client.insert(videos).values({
    id: params.id,
    generationJobId: params.jobId,
    index: params.index,
    storagePath: params.storagePath,
    contentType: params.contentType,
    width: params.width,
    height: params.height,
    durationSeconds: params.durationSeconds,
    sizeBytes: params.sizeBytes,
    createdAt: params.createdAt,
  }).onConflictDoNothing().run().changes > 0;
}

export function videoExists(
  jobId: string,
  index: number,
  client: DbClient = db,
): boolean {
  return client.select({ id: videos.id }).from(videos)
    .where(and(eq(videos.generationJobId, jobId), eq(videos.index, index)))
    .get() !== undefined;
}

export function getVideo(id: string, client: DbClient = db): Video {
  const row = client.select().from(videos).where(eq(videos.id, id)).get();
  if (!row) throw new NotFoundError(`Video not found: ${id}`);
  return row;
}
