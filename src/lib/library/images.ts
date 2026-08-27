import {
  db,
  getImage,
  getGenerationJob,
  getImageAvailability,
  listFavoriteImageIds,
  markImageStorageMissing,
  markRemoteImageExpired,
  markImageUserDeleted,
  type DbClient,
  type Image,
} from '../db';
import { ImageUnavailableError, NotFoundError } from '../errors';
import { assertStorageWritable, getReadStream, removeStoredFile } from '../storage';
import { logSafeEvent } from '../observability/safe-logger';
import { acceptProviderRemoteImage } from '../media-output/remote-url';
import type { ProviderId } from '../providers';

export type ReadableImage = {
  image: Image & { storagePath: string };
  stream: ReturnType<typeof getReadStream>;
};

export type DeliverableImage =
  | { kind: 'managed'; image: Image & { storagePath: string }; stream: ReturnType<typeof getReadStream> }
  | { kind: 'remote'; image: Image & { remoteUrl: string }; url: string; provider: ProviderId; hostname: string };

function unavailable(image: Image): ImageUnavailableError {
  const availability = getImageAvailability(image);
  if (availability === 'available') {
    return new ImageUnavailableError('storage_missing');
  }
  return new ImageUnavailableError(availability);
}

export function openReadableImage(
  id: string,
  client: DbClient = db,
): ReadableImage {
  const image = getImage(id, client);
  if (image.storagePath === null) throw unavailable(image);
  try {
    return {
      image: image as Image & { storagePath: string },
      stream: getReadStream(image.storagePath),
    };
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
    const wasFavorite = listFavoriteImageIds([id], client).has(id);
    markImageStorageMissing(id, new Date().toISOString(), client);
    logSafeEvent({ event: 'storage.missing_detected', imageId: id, wasFavorite });
    throw new ImageUnavailableError('storage_missing');
  }
}

export function openDeliverableImage(
  id: string,
  client: DbClient = db,
): DeliverableImage {
  const image = getImage(id, client);
  if (image.sourceKind === 'managed') {
    const readable = openReadableImage(id, client);
    return { kind: 'managed', ...readable };
  }
  if (image.remoteUrl === null) throw unavailable(image);
  if (
    image.remoteExpiresAt !== null &&
    Date.parse(image.remoteExpiresAt) <= Date.now()
  ) {
    markRemoteImageExpired(id, new Date().toISOString(), client);
    throw new ImageUnavailableError('remote_expired');
  }
  const job = getGenerationJob(image.generationJobId, client);
  if (!job) throw new NotFoundError(`Generation job not found: ${image.generationJobId}`);
  const accepted = acceptProviderRemoteImage(
    job.provider as ProviderId,
    job.model,
    image.remoteUrl,
  );
  return {
    kind: 'remote',
    image: image as Image & { remoteUrl: string },
    url: accepted.url,
    provider: job.provider as ProviderId,
    hostname: accepted.hostname,
  };
}

export function deleteImageBytes(
  id: string,
  client: DbClient = db,
): void {
  assertStorageWritable();
  const result = markImageUserDeleted(id, new Date().toISOString(), client);
  if (!result) throw new NotFoundError(`Image not found: ${id}`);
  if (!result.storagePath) return;
  try {
    removeStoredFile(result.storagePath);
  } catch {
    // The DB tombstone is authoritative. Orphan cleanup retries the file later.
  }
}

export function imageDownloadFilename(image: Image): string {
  const extension =
    image.contentType === 'image/jpeg'
      ? 'jpg'
      : image.contentType === 'image/webp'
        ? 'webp'
        : 'png';
  const date = /^\d{4}-\d{2}-\d{2}/.exec(image.createdAt)?.[0] ?? 'image';
  const shortId = image.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'result';
  return `generated-${date}-${shortId}.${extension}`;
}
