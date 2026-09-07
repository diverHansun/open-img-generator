import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNotNull, isNull, lt, or, type SQL } from 'drizzle-orm';
import {
  db,
  favorites,
  generationJobs,
  generations,
  getImage,
  getImageAvailability,
  images,
  promoteRemoteImageToManaged,
  projects,
  sessions,
  type DbClient,
} from '../db';
import { ImageUnavailableError, NotFoundError, ValidationError } from '../errors';
import { getProject } from './projects';
import { isKnownProviderId } from '../provider-config/catalog';
import type { GalleryItem, Page } from './types';
import { downloadAndStore, removeStoredFile } from '../storage';
import type { DownloadAndStoreResult } from '../storage';

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
      remoteUrl: images.remoteUrl,
      sourceKind: images.sourceKind,
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
  const {
    storagePath: _storagePath,
    remoteUrl: _remoteUrl,
    sourceKind,
    removalReason: _removalReason,
    ...item
  } = row;
  return {
    ...item,
    delivery: sourceKind as 'managed' | 'remote',
    url: availability === 'available' ? `/api/images/${row.imageId}` : null,
    availability,
  };
}

function unavailableImage(imageId: string, client: DbClient): never {
  const image = getImage(imageId, client);
  const availability = getImageAvailability(image);
  if (availability !== 'available') throw new ImageUnavailableError(availability);
  throw new NotFoundError(`Image not found: ${imageId}`);
}

function insertFavorite(imageId: string, client: DbClient): void {
  const image = client
    .select({ id: images.id })
    .from(images)
    .where(and(
      eq(images.id, imageId),
      eq(images.sourceKind, 'managed'),
      isNotNull(images.storagePath),
      isNull(images.removedAt),
    ))
    .get();
  if (!image) unavailableImage(imageId, client);
  client.insert(favorites)
    .values({ id: randomUUID(), imageId, createdAt: new Date().toISOString() })
    .onConflictDoNothing({ target: favorites.imageId })
    .run();
}

export async function addFavorite(
  imageId: string,
  client: DbClient = db,
): Promise<GalleryItem> {
  const image = getImage(imageId, client);
  if (image.sourceKind === 'managed') {
    client.transaction((tx) => insertFavorite(imageId, tx), { behavior: 'immediate' });
    return getFavoriteByImageId(imageId, client);
  }
  if (image.remoteUrl === null) unavailableImage(imageId, client);

  const stored = await downloadAndStore(image.remoteUrl);
  let promotedStoredBytes = false;
  try {
    client.transaction((tx) => {
      const promoted = promoteRemoteImageToManaged(imageId, stored, tx);
      promotedStoredBytes = promoted;
      if (!promoted) {
        const current = getImage(imageId, tx);
        if (current.sourceKind !== 'managed' || current.storagePath === null) {
          unavailableImage(imageId, tx);
        }
      }
      insertFavorite(imageId, tx);
    }, { behavior: 'immediate' });
  } catch (error) {
    try {
      removeStoredFile(stored.storagePath);
    } catch {
      // Orphan cleanup handles a crash or failed compensation.
    }
    throw error;
  }
  if (!promotedStoredBytes) {
    try {
      removeStoredFile(stored.storagePath);
    } catch {
      // Orphan cleanup handles a crash or failed compensation.
    }
  }
  return getFavoriteByImageId(imageId, client);
}

/**
 * Promotes bytes retrieved by the user's browser after the server-side CDN
 * path failed. It intentionally does not create a favorite: the caller retries
 * the normal favorite command only after this durable handoff succeeds.
 */
export function pinRemoteImage(
  imageId: string,
  stored: DownloadAndStoreResult,
  client: DbClient = db,
): void {
  let promotedStoredBytes = false;
  try {
    client.transaction((tx) => {
      promotedStoredBytes = promoteRemoteImageToManaged(imageId, stored, tx);
      if (!promotedStoredBytes) {
        const current = getImage(imageId, tx);
        if (current.sourceKind !== 'managed' || current.storagePath === null) {
          unavailableImage(imageId, tx);
        }
      }
    }, { behavior: 'immediate' });
  } catch (error) {
    try {
      removeStoredFile(stored.storagePath);
    } catch {
      // Orphan cleanup handles a crash or failed compensation.
    }
    throw error;
  }
  if (!promotedStoredBytes) {
    try {
      removeStoredFile(stored.storagePath);
    } catch {
      // Orphan cleanup handles a crash or failed compensation.
    }
  }
}

/** Returns whether a browser relay still needs bytes for this image. */
export function isRemoteImagePinRequired(
  imageId: string,
  client: DbClient = db,
): boolean {
  const image = getImage(imageId, client);
  if (
    image.sourceKind === 'managed' &&
    image.storagePath !== null &&
    image.removedAt === null
  ) {
    return false;
  }
  if (
    image.sourceKind === 'remote' &&
    image.remoteUrl !== null &&
    image.removedAt === null
  ) {
    return true;
  }
  unavailableImage(imageId, client);
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
