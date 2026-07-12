import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { ReadableStream } from 'node:stream/web';
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

export async function downloadAndStore(url: string): Promise<DownloadAndStoreResult> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    throw new StorageError(`Failed to download image from ${url}`, err);
  }

  if (!response.ok) {
    throw new StorageError(`Download failed with status ${response.status}: ${url}`);
  }

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? 'application/octet-stream';
  let buffer: ArrayBuffer;
  try {
    buffer = await response.arrayBuffer();
  } catch (err) {
    throw new StorageError(`Failed to read image body from ${url}`, err);
  }

  ensureRootExists();
  const storagePath = generateStoragePath(contentType);
  const absolutePath = path.join(getStorageRoot(), storagePath);
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

export function getReadStream(storagePath: string): ReadableStream<Uint8Array> {
  const root = getStorageRoot();
  const absolutePath = path.resolve(path.join(root, storagePath));
  const relativeToRoot = path.relative(root, absolutePath);

  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new StorageError(`Invalid storage path: ${storagePath}`);
  }

  if (!fs.existsSync(absolutePath)) {
    throw new NotFoundError(`Image not found: ${storagePath}`);
  }

  const nodeStream = fs.createReadStream(absolutePath);
  return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
}
