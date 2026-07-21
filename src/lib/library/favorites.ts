import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNotNull, lt, or, type SQL } from 'drizzle-orm';
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
import { getProject } from './projects';
import { isKnownProviderId } from '../provider-config/catalog';
import type { GalleryItem, Page } from './types';
import { getImageAvailability } from '../db';

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
      storagePath: images.storagePath,
      removedAt: images.removedAt,
      removalReason: images.removalReason,
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
  const availability = getImageAvailability(row);
  const { storagePath: _storagePath, removalReason: _removalReason, ...item } = row;
  return {
    ...item,
    url: availability === 'available' ? `/api/images/${row.imageId}` : null,
    availability,
  };
}

export function addFavorite(imageId: string, client: DbClient = db): GalleryItem {
  client.transaction(
    (tx) => {
      const image = tx
        .select({ id: images.id })
        .from(images)
        .where(and(eq(images.id, imageId), isNotNull(images.storagePath)))
        .get();
      if (!image) throw new NotFoundError(`Image not found: ${imageId}`);
      tx.insert(favorites)
        .values({ id: randomUUID(), imageId, createdAt: new Date().toISOString() })
        .onConflictDoNothing({ target: favorites.imageId })
        .run();
    },
    { behavior: 'immediate' },
  );
  return getFavoriteByImageId(imageId, client);
}

export function getFavoriteByImageId(
  imageId: string,
  client: DbClient = db,
): GalleryItem {
  return toGalleryItem(
    favoriteQuery(client)
      .where(eq(favorites.imageId, imageId))
      .get(),
  );
}

export function removeFavorite(imageId: string, client: DbClient = db): void {
  const result = client.delete(favorites).where(eq(favorites.imageId, imageId)).run();
  if (result.changes === 0) throw new NotFoundError(`Favorite not found: ${imageId}`);
}

export function listFavorites(
  input: {
    limit?: number;
    cursor?: string;
    projectId?: string;
    provider?: string;
    sort?: string;
  },
  client: DbClient = db,
): Page<GalleryItem> {
  if (
    input.limit !== undefined &&
    (!Number.isInteger(input.limit) || input.limit < 1)
  ) {
    throw new ValidationError('limit must be a positive integer');
  }
  if (input.sort !== undefined && input.sort !== 'newest') {
    throw new ValidationError('sort must be newest');
  }
  if (input.projectId !== undefined && input.projectId.trim().length === 0) {
    throw new ValidationError('projectId must not be empty');
  }
  if (input.provider !== undefined && !isKnownProviderId(input.provider)) {
    throw new ValidationError('Unknown provider');
  }
  if (input.projectId) getProject(input.projectId, client);
  const limit = Math.min(input.limit ?? 48, 100);
  const cursor = decodeCursor(input.cursor);
  const conditions: SQL[] = [];
  if (cursor) {
    const cursorCondition = or(
      lt(favorites.createdAt, cursor.createdAt),
      and(eq(favorites.createdAt, cursor.createdAt), lt(favorites.id, cursor.id)),
    );
    if (cursorCondition) conditions.push(cursorCondition);
  }
  if (input.projectId) conditions.push(eq(projects.id, input.projectId));
  if (input.provider) conditions.push(eq(generationJobs.provider, input.provider));
  const rows = favoriteQuery(client)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
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
