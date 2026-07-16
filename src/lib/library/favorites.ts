import { randomUUID } from 'node:crypto';
import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import {
  db,
  favorites,
  generationJobs,
  generations,
  images,
  projects,
  sessions,
  type DbClient,
} from '../db';
import { NotFoundError, ValidationError } from '../errors';
import type { GalleryItem, Page } from './types';

type Cursor = { createdAt: string; id: string };

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(cursor: string | undefined): Cursor | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Cursor;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') {
      throw new Error('invalid cursor');
    }
    return parsed;
  } catch {
    throw new ValidationError('Invalid cursor');
  }
}

function favoriteQuery(client: DbClient) {
  return client
    .select({
      favoriteId: favorites.id,
      imageId: images.id,
      width: images.width,
      height: images.height,
      favoritedAt: favorites.createdAt,
      jobId: generationJobs.id,
      provider: generationJobs.provider,
      model: generationJobs.model,
      generationId: generations.id,
      prompt: generations.prompt,
      sessionId: sessions.id,
      projectId: projects.id,
      projectTitle: projects.title,
    })
    .from(favorites)
    .innerJoin(images, eq(favorites.imageId, images.id))
    .innerJoin(generationJobs, eq(images.generationJobId, generationJobs.id))
    .innerJoin(generations, eq(generationJobs.generationId, generations.id))
    .innerJoin(sessions, eq(generations.sessionId, sessions.id))
    .innerJoin(projects, eq(sessions.projectId, projects.id));
}

function toGalleryItem(row: ReturnType<ReturnType<typeof favoriteQuery>['get']>): GalleryItem {
  if (!row) throw new NotFoundError('Favorite not found');
  return { ...row, url: `/api/images/${row.imageId}` };
}

export function addFavorite(imageId: string, client: DbClient = db): GalleryItem {
  const image = client.select({ id: images.id }).from(images).where(eq(images.id, imageId)).get();
  if (!image) throw new NotFoundError(`Image not found: ${imageId}`);
  client
    .insert(favorites)
    .values({ id: randomUUID(), imageId, createdAt: new Date().toISOString() })
    .onConflictDoNothing({ target: favorites.imageId })
    .run();
  return getFavoriteByImageId(imageId, client);
}

export function getFavoriteByImageId(
  imageId: string,
  client: DbClient = db,
): GalleryItem {
  return toGalleryItem(favoriteQuery(client).where(eq(favorites.imageId, imageId)).get());
}

export function removeFavorite(imageId: string, client: DbClient = db): void {
  const result = client.delete(favorites).where(eq(favorites.imageId, imageId)).run();
  if (result.changes === 0) throw new NotFoundError(`Favorite not found: ${imageId}`);
}

export function listFavorites(
  input: { limit?: number; cursor?: string },
  client: DbClient = db,
): Page<GalleryItem> {
  if (
    input.limit !== undefined &&
    (!Number.isInteger(input.limit) || input.limit < 1)
  ) {
    throw new ValidationError('limit must be a positive integer');
  }
  const limit = Math.min(input.limit ?? 48, 100);
  const cursor = decodeCursor(input.cursor);
  let condition: SQL | undefined;
  if (cursor) {
    condition = or(
      lt(favorites.createdAt, cursor.createdAt),
      and(eq(favorites.createdAt, cursor.createdAt), lt(favorites.id, cursor.id)),
    );
  }
  const rows = favoriteQuery(client)
    .where(condition)
    .orderBy(desc(favorites.createdAt), desc(favorites.id))
    .limit(limit + 1)
    .all();
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    items: pageRows.map((row) => toGalleryItem(row)),
    nextCursor:
      hasMore && last
        ? encodeCursor({ createdAt: last.favoritedAt, id: last.favoriteId })
        : null,
  };
}
