import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { NotFoundError, StorageError } from '../errors';

export type DownloadAndStoreResult = {
  storagePath: string;
  contentType: string;
  sizeBytes: number;
};

export function getStorageRoot(): string {
  const root = process.env.LOCAL_STORAGE_DIR ?? './data/images';
  return path.resolve(root);
}

function ensureRootExists(): void {
  const root = getStorageRoot();
  fs.mkdirSync(root, { recursive: true });
}

function extensionFromContentType(contentType: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
  };
  return map[contentType.toLowerCase()] ?? '.bin';
}

function generateStoragePath(contentType: string): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const id = randomUUID();
  return path.join(String(year), month, `${id}${extensionFromContentType(contentType)}`);
}

function resolveStoragePath(storagePath: string): string {
  const root = getStorageRoot();
  const absolutePath = path.resolve(path.join(root, storagePath));
  const relativeToRoot = path.relative(root, absolutePath);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new StorageError(`Invalid storage path: ${storagePath}`);
  }
  return absolutePath;
}

export async function downloadAndStore(url: string): Promise<DownloadAndStoreResult> {
  let contentType = 'application/octet-stream';
  let buffer: ArrayBuffer;

  if (url.startsWith('data:')) {
    const match = /^data:([^;,]+)?;base64,(.*)$/s.exec(url);
    if (!match) {
      throw new StorageError('Invalid Base64 image data URL');
    }

    contentType = match[1] ?? contentType;
    try {
      const decoded = Buffer.from(match[2]!, 'base64');
      if (decoded.length === 0) {
        throw new Error('empty image payload');
      }
      buffer = decoded.buffer.slice(
        decoded.byteOffset,
        decoded.byteOffset + decoded.byteLength,
      );
    } catch (err) {
      throw new StorageError('Failed to decode Base64 image data', err);
    }
  } else {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    } catch (err) {
      throw new StorageError(`Failed to download image from ${url}`, err);
    }

    if (!response.ok) {
      throw new StorageError(`Download failed with status ${response.status}: ${url}`);
    }

    contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? contentType;
    try {
      buffer = await response.arrayBuffer();
    } catch (err) {
      throw new StorageError(`Failed to read image body from ${url}`, err);
    }
  }

  ensureRootExists();
  const storagePath = generateStoragePath(contentType);
  const absolutePath = resolveStoragePath(storagePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

  try {
    fs.writeFileSync(absolutePath, Buffer.from(buffer));
  } catch (err) {
    throw new StorageError(`Failed to write image to ${absolutePath}`, err);
  }

  return {
    storagePath,
    contentType,
    sizeBytes: buffer.byteLength,
  };
}

/** Best-effort cleanup for a file that lost an idempotent image insert race. */
export function removeStoredFile(storagePath: string): void {
  const absolutePath = resolveStoragePath(storagePath);
  try {
    fs.rmSync(absolutePath, { force: true });
  } catch (err) {
    throw new StorageError(`Failed to remove stored image ${storagePath}`, err);
  }
}

export function getReadStream(storagePath: string): ReadableStream<Uint8Array> {
  const absolutePath = resolveStoragePath(storagePath);

  if (!fs.existsSync(absolutePath)) {
    throw new NotFoundError(`Image not found: ${storagePath}`);
  }

  const nodeStream = fs.createReadStream(absolutePath);
  return Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
}

export { cleanupStoredImages } from './cleanup';
