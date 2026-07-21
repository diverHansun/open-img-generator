import {
  db,
  getImage,
  getImageAvailability,
  markImageStorageMissing,
  markImageUserDeleted,
  type DbClient,
  type Image,
} from '../db';
import { ImageUnavailableError, NotFoundError } from '../errors';
import { getReadStream, removeStoredFile } from '../storage';

export type ReadableImage = {
  image: Image & { storagePath: string };
  stream: ReturnType<typeof getReadStream>;
};

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
    markImageStorageMissing(id, new Date().toISOString(), client);
    throw new ImageUnavailableError('storage_missing');
  }
}

export function deleteImageBytes(
  id: string,
  client: DbClient = db,
): void {
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
