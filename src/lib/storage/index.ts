import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { NotFoundError, StorageError } from '../errors';

const STAGING_PREFIX = 'staging:';
const STAGING_DIRECTORY = '.staging';
const MAX_INLINE_IMAGE_BYTES = 25 * 1024 * 1024;
const STAGING_EXTENSIONS = ['.png', '.jpg', '.webp', '.gif', '.bin'] as const;
const INLINE_IMAGE_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

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

function contentTypeFromExtension(extension: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  return map[extension] ?? 'application/octet-stream';
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

function getStagingRoot(): string {
  return path.join(getStorageRoot(), STAGING_DIRECTORY);
}

function parseStagingReference(reference: string): string | null {
  const match = /^staging:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(reference);
  return match?.[1] ?? null;
}

function findStagedFile(reference: string): { absolutePath: string; contentType: string } | null {
  const id = parseStagingReference(reference);
  if (!id) return null;
  for (const extension of STAGING_EXTENSIONS) {
    const absolutePath = path.join(getStagingRoot(), `${id}${extension}`);
    if (fs.existsSync(absolutePath)) {
      return { absolutePath, contentType: contentTypeFromExtension(extension) };
    }
  }
  return null;
}

function parseInlineImageDataUrl(dataUrl: string): { contentType: string; buffer: Buffer } {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/is.exec(dataUrl);
  if (!match) throw new StorageError('Invalid Base64 image data URL');
  const rawContentType = match[1]!.trim().toLowerCase();
  const contentType = rawContentType === 'image/jpg' ? 'image/jpeg' : rawContentType;
  if (!INLINE_IMAGE_CONTENT_TYPES.has(contentType)) {
    throw new StorageError('Inline image content type is not supported');
  }
  const encoded = match[2]!;
  if (encoded.length % 4 === 1) throw new StorageError('Invalid Base64 image data URL');
  const maxEncodedBytes = Math.ceil((MAX_INLINE_IMAGE_BYTES * 4) / 3) + 4;
  if (encoded.length > maxEncodedBytes) {
    throw new StorageError('Inline image exceeds the maximum allowed size');
  }
  const padding = '='.repeat((4 - (encoded.length % 4)) % 4);
  const buffer = Buffer.from(`${encoded}${padding}`, 'base64');
  if (buffer.length === 0) throw new StorageError('Inline image payload is empty');
  if (buffer.length > MAX_INLINE_IMAGE_BYTES) {
    throw new StorageError('Inline image exceeds the maximum allowed size');
  }
  return { contentType, buffer };
}

/** A validated opaque reference that is safe to persist in a result snapshot. */
export function isStagedImageRef(value: unknown): value is `staging:${string}` {
  return typeof value === 'string' && parseStagingReference(value) !== null;
}

/**
 * Moves an inline provider response out of process memory before the lifecycle
 * records its result snapshot. The database only receives `staging:<uuid>`.
 */
export function stageInlineImage(
  dataUrl: string,
  expectedContentType?: string,
): { reference: string; contentType: string; sizeBytes: number } {
  const { contentType, buffer } = parseInlineImageDataUrl(dataUrl);
  const expected = expectedContentType?.trim().toLowerCase();
  const normalizedExpected = expected === 'image/jpg' ? 'image/jpeg' : expected;
  if (normalizedExpected && normalizedExpected !== contentType) {
    throw new StorageError('Inline image content type does not match provider metadata');
  }
  const id = randomUUID();
  const extension = extensionFromContentType(contentType);
  const root = getStagingRoot();
  const finalPath = path.join(root, `${id}${extension}`);
  const temporaryPath = path.join(root, `.${id}.tmp`);
  fs.mkdirSync(root, { recursive: true });
  try {
    fs.writeFileSync(temporaryPath, buffer, { flag: 'wx' });
    fs.renameSync(temporaryPath, finalPath);
  } catch (err) {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // The original write error remains authoritative.
    }
    throw new StorageError('Failed to stage inline image data', err);
  }
  return { reference: `${STAGING_PREFIX}${id}`, contentType, sizeBytes: buffer.length };
}

/** Best-effort cleanup for a snapshot that was superseded or cancelled. */
export function removeStagedImage(reference: string): void {
  const staged = findStagedFile(reference);
  if (!staged) return;
  try {
    fs.rmSync(staged.absolutePath, { force: true });
  } catch (err) {
    throw new StorageError('Failed to remove staged image', err);
  }
}

function materializeStagedImage(reference: string): DownloadAndStoreResult {
  const staged = findStagedFile(reference);
  if (!staged) throw new StorageError('Staged image is unavailable');
  const sizeBytes = fs.statSync(staged.absolutePath).size;
  const storagePath = generateStoragePath(staged.contentType);
  const absolutePath = resolveStoragePath(storagePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  try {
    // Keep the durable staging source until the lifecycle's lease-guarded DB
    // checkpoint commits. A crash after this copy leaves an orphan attempt file
    // but never destroys the only recoverable result reference.
    fs.copyFileSync(staged.absolutePath, absolutePath, fs.constants.COPYFILE_EXCL);
  } catch (err) {
    throw new StorageError('Failed to materialize staged image', err);
  }
  return { storagePath, contentType: staged.contentType, sizeBytes };
}

export async function downloadAndStore(url: string): Promise<DownloadAndStoreResult> {
  if (isStagedImageRef(url)) return materializeStagedImage(url);
  if (url.startsWith(STAGING_PREFIX)) {
    throw new StorageError('Invalid staged image reference');
  }
  let contentType = 'application/octet-stream';
  let buffer: Buffer;

  if (url.startsWith('data:')) {
    const inline = parseInlineImageDataUrl(url);
    contentType = inline.contentType;
    buffer = inline.buffer;
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
      buffer = Buffer.from(await response.arrayBuffer());
    } catch (err) {
      throw new StorageError(`Failed to read image body from ${url}`, err);
    }
  }

  ensureRootExists();
  const storagePath = generateStoragePath(contentType);
  const absolutePath = resolveStoragePath(storagePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

  try {
    fs.writeFileSync(absolutePath, buffer);
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
