import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import {
  NotFoundError,
  StorageError,
  type StorageDiagnostic,
} from '../errors';
import {
  RemoteImageUrlError,
  validateRemoteImageUrl,
  type RemoteImageUrlPolicyOptions,
} from './image-url-policy';
import { verifyStorageOwnership } from './ownership';

const STAGING_PREFIX = 'staging:';
const STAGING_DIRECTORY = '.staging';
const TEMPORARY_DIRECTORY = '.tmp';
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
// Keep .gif discoverable so unfinished pre-E3 staging rows can be safely
// removed by lifecycle/cleanup. It is never materialized because the current
// MIME + magic allowlist rejects it.
const STAGING_EXTENSIONS = ['.png', '.jpg', '.webp', '.gif', '.bin'] as const;
const INLINE_IMAGE_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export type DownloadAndStoreResult = {
  storagePath: string;
  contentType: string;
  sizeBytes: number;
};

type BytePrefix = Uint8Array<ArrayBufferLike>;

function safeRemoteHostname(value: string | URL): string | undefined {
  try {
    return (value instanceof URL ? value : new URL(value)).hostname || undefined;
  } catch {
    return undefined;
  }
}

function storageDiagnosticForUrlError(
  error: RemoteImageUrlError,
): StorageDiagnostic {
  let category: StorageDiagnostic['category'];
  switch (error.reason) {
    case 'dns_failed':
      category = 'remote_dns_failed';
      break;
    case 'address_blocked':
      category = 'remote_address_blocked';
      break;
    case 'proxy_mapping_not_trusted':
      category = 'proxy_mapping_not_trusted';
      break;
    case 'invalid_url':
      category = 'remote_url_invalid';
      break;
  }
  return { category, ...(error.hostname ? { hostname: error.hostname } : {}) };
}

export function getStorageRoot(): string {
  const root = process.env.LOCAL_STORAGE_DIR ?? './data/images';
  return path.resolve(root);
}

function ensureRootExists(): void {
  const root = getStorageRoot();
  try {
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
    verifyStorageOwnership(root);
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError('Local storage directory is unavailable', {
      cause: error,
      diagnostic: { category: 'local_write_failed' },
    });
  }
}

export function assertStorageWritable(): void {
  ensureRootExists();
}

function extensionFromContentType(contentType: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
  };
  return map[contentType.toLowerCase()] ?? '.bin';
}

function contentTypeFromExtension(extension: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
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

function getTemporaryRoot(): string {
  return path.join(getStorageRoot(), TEMPORARY_DIRECTORY);
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

function normalizeImageContentType(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.split(';')[0]?.trim().toLowerCase();
  if (!normalized) return null;
  const contentType = normalized === 'image/jpg' ? 'image/jpeg' : normalized;
  return INLINE_IMAGE_CONTENT_TYPES.has(contentType) ? contentType : null;
}

function parseInlineImageDataUrl(dataUrl: string): {
  contentType: string;
  encoded: string;
} {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/is.exec(dataUrl);
  if (!match) throw new StorageError('Invalid Base64 image data URL');
  const contentType = normalizeImageContentType(match[1]);
  if (!contentType) {
    throw new StorageError('Inline image content type is not supported');
  }
  const encoded = match[2]!;
  if (encoded.length % 4 === 1) throw new StorageError('Invalid Base64 image data URL');
  const maxEncodedBytes = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4;
  if (encoded.length > maxEncodedBytes) {
    throw new StorageError('Inline image exceeds the maximum allowed size');
  }
  return { contentType, encoded };
}

function imageContentTypeFromMagic(bytes: BytePrefix): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function assertImageMagic(contentType: string, prefix: BytePrefix): void {
  if (imageContentTypeFromMagic(prefix) !== contentType) {
    throw new StorageError('Image content type does not match its binary signature');
  }
}

function appendPrefix(prefix: BytePrefix, chunk: Uint8Array): BytePrefix {
  const remaining = Math.max(0, 12 - prefix.byteLength);
  if (remaining === 0) return prefix;
  const result = new Uint8Array(prefix.byteLength + Math.min(remaining, chunk.byteLength));
  result.set(prefix);
  result.set(chunk.slice(0, remaining), prefix.byteLength);
  return result;
}

function removeTemporaryFile(temporaryPath: string): void {
  try {
    fs.rmSync(temporaryPath, { force: true });
  } catch {
    // Original storage failure remains authoritative.
  }
}

function writeBase64ToTemporary(
  encoded: string,
  temporaryPath: string,
): { sizeBytes: number; prefix: BytePrefix } {
  // 64 KiB is divisible by four, so every non-final Base64 quantum can be
  // decoded independently without carrying parser state between chunks.
  const chunkLength = 64 * 1_024;
  const file = fs.openSync(temporaryPath, 'wx');
  let sizeBytes = 0;
  let prefix: BytePrefix = new Uint8Array();
  try {
    for (let offset = 0; offset < encoded.length; offset += chunkLength) {
      const source = encoded.slice(offset, offset + chunkLength);
      const isLast = offset + chunkLength >= encoded.length;
      const padding = isLast ? '='.repeat((4 - (source.length % 4)) % 4) : '';
      const chunk = Buffer.from(`${source}${padding}`, 'base64');
      sizeBytes += chunk.byteLength;
      if (sizeBytes > MAX_IMAGE_BYTES) {
        throw new StorageError('Inline image exceeds the maximum allowed size');
      }
      if (chunk.byteLength > 0) fs.writeSync(file, chunk);
      prefix = appendPrefix(prefix, chunk);
    }
  } finally {
    fs.closeSync(file);
  }
  if (sizeBytes === 0) throw new StorageError('Inline image payload is empty');
  return { sizeBytes, prefix };
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The caller is already rejecting this remote response.
  }
}

function declaredBodyLength(response: Response): number | null {
  try {
    const contentEncoding = response.headers.get('content-encoding')?.trim().toLowerCase();
    // Native fetch transparently decompresses the body but retains the encoded
    // Content-Length header, so equality is meaningful only for identity data.
    if (contentEncoding && contentEncoding !== 'identity') return null;
    const value = response.headers.get('content-length');
    if (!value || !/^\d+$/.test(value.trim())) return null;
    const length = Number(value);
    return Number.isSafeInteger(length) ? length : null;
  } catch {
    return null;
  }
}

function parseRetryAfterMs(response: Response): number | undefined {
  try {
    const value = response.headers.get('retry-after')?.trim();
    if (!value) return undefined;
    if (/^\d+(?:\.\d+)?$/.test(value)) {
      return Math.min(60_000, Math.ceil(Number(value) * 1_000));
    }
    const dateMs = Date.parse(value);
    return Number.isFinite(dateMs)
      ? Math.min(60_000, Math.max(0, dateMs - Date.now()))
      : undefined;
  } catch {
    return undefined;
  }
}

async function writeResponseToTemporary(
  response: Response,
  temporaryPath: string,
  maxBytes = MAX_IMAGE_BYTES,
): Promise<{ sizeBytes: number; prefix: BytePrefix }> {
  const declaredLength = declaredBodyLength(response);
  if (declaredLength !== null && declaredLength > maxBytes) {
    await cancelResponseBody(response);
    throw new StorageError('Image exceeds the maximum allowed size');
  }
  const body = response.body;
  if (!body) throw new StorageError('Image response has no body');

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let file: number | null = null;
  let sizeBytes = 0;
  let prefix: BytePrefix = new Uint8Array();
  let completed = false;
  try {
    file = fs.openSync(temporaryPath, 'wx');
    reader = body.getReader();
    while (true) {
      let read: ReadableStreamReadResult<Uint8Array>;
      try {
        read = await reader.read();
      } catch (err) {
        throw new StorageError('Remote image response could not be read', {
          cause: err,
          retryable: true,
        });
      }
      const { done, value } = read;
      if (done) break;
      sizeBytes += value.byteLength;
      if (sizeBytes > maxBytes) {
        throw new StorageError('Image exceeds the maximum allowed size');
      }
      try {
        fs.writeSync(file, value);
      } catch (err) {
        throw new StorageError('Failed to write remote image data', { cause: err });
      }
      prefix = appendPrefix(prefix, value);
    }
    if (declaredLength !== null && sizeBytes !== declaredLength) {
      throw new StorageError('Image response ended before its advertised length', {
        retryable: true,
      });
    }
    completed = true;
  } finally {
    if (!completed) {
      if (reader) {
        try {
          await reader.cancel();
        } catch {
          // Failure cleanup must not mask the original read/write error.
        }
      } else {
        await cancelResponseBody(response);
      }
    }
    if (file !== null) fs.closeSync(file);
    reader?.releaseLock();
  }
  if (sizeBytes === 0) throw new StorageError('Image response is empty');
  return { sizeBytes, prefix };
}

function temporaryPath(): string {
  ensureRootExists();
  const root = getTemporaryRoot();
  fs.mkdirSync(root, { recursive: true });
  return path.join(root, `${randomUUID()}.tmp`);
}

function moveTemporaryImage(
  sourcePath: string,
  contentType: string,
): DownloadAndStoreResult {
  ensureRootExists();
  const storagePath = generateStoragePath(contentType);
  const absolutePath = resolveStoragePath(storagePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  try {
    fs.renameSync(sourcePath, absolutePath);
  } catch (err) {
    throw new StorageError('Failed to finalize stored image', { cause: err });
  }
  return {
    storagePath,
    contentType,
    sizeBytes: fs.statSync(absolutePath).size,
  };
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
  ensureRootExists();
  const { contentType, encoded } = parseInlineImageDataUrl(dataUrl);
  const normalizedExpected = normalizeImageContentType(expectedContentType);
  if (expectedContentType && !normalizedExpected) {
    throw new StorageError('Inline image content type is not supported');
  }
  if (normalizedExpected && normalizedExpected !== contentType) {
    throw new StorageError('Inline image content type does not match provider metadata');
  }
  const id = randomUUID();
  const root = getStagingRoot();
  const temporaryPath = path.join(root, `.${id}.tmp`);
  const finalPath = path.join(root, `${id}${extensionFromContentType(contentType)}`);
  fs.mkdirSync(root, { recursive: true });
  try {
    const written = writeBase64ToTemporary(encoded, temporaryPath);
    assertImageMagic(contentType, written.prefix);
    fs.renameSync(temporaryPath, finalPath);
  } catch (err) {
    removeTemporaryFile(temporaryPath);
    if (err instanceof StorageError) throw err;
    throw new StorageError('Failed to stage inline image data', { cause: err });
  }
  return {
    reference: `${STAGING_PREFIX}${id}`,
    contentType,
    sizeBytes: fs.statSync(finalPath).size,
  };
}

/** Best-effort cleanup for a snapshot that was superseded or cancelled. */
export function removeStagedImage(reference: string): void {
  ensureRootExists();
  const staged = findStagedFile(reference);
  if (!staged) return;
  try {
    fs.rmSync(staged.absolutePath, { force: true });
  } catch (err) {
    throw new StorageError('Failed to remove staged image', { cause: err });
  }
}

function materializeStagedImage(reference: string): DownloadAndStoreResult {
  ensureRootExists();
  const staged = findStagedFile(reference);
  if (!staged) throw new StorageError('Staged image is unavailable');
  const sizeBytes = fs.statSync(staged.absolutePath).size;
  if (sizeBytes === 0 || sizeBytes > MAX_IMAGE_BYTES) {
    throw new StorageError('Staged image is invalid');
  }
  const prefix = Buffer.alloc(12);
  const file = fs.openSync(staged.absolutePath, 'r');
  try {
    fs.readSync(file, prefix, 0, prefix.length, 0);
  } finally {
    fs.closeSync(file);
  }
  assertImageMagic(staged.contentType, prefix);
  const storagePath = generateStoragePath(staged.contentType);
  const absolutePath = resolveStoragePath(storagePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  try {
    // Keep the durable staging source until the lifecycle's lease-guarded DB
    // checkpoint commits. A crash after this copy leaves an orphan attempt file
    // but never destroys the only recoverable result reference.
    fs.copyFileSync(staged.absolutePath, absolutePath, fs.constants.COPYFILE_EXCL);
  } catch (err) {
    throw new StorageError('Failed to materialize staged image', { cause: err });
  }
  return { storagePath, contentType: staged.contentType, sizeBytes };
}

export type DownloadAndStoreOptions = RemoteImageUrlPolicyOptions;

async function fetchRemoteImage(
  initialUrl: string,
  options: DownloadAndStoreOptions,
): Promise<Response> {
  let nextUrl: URL;
  try {
    nextUrl = await validateRemoteImageUrl(initialUrl, options);
  } catch (err) {
    if (err instanceof RemoteImageUrlError) {
      throw new StorageError('Remote image URL is not allowed', {
        diagnostic: storageDiagnosticForUrlError(err),
      });
    }
    throw new StorageError('Remote image URL could not be validated', {
      diagnostic: { category: 'remote_url_invalid' },
    });
  }

  const deadlineAt = Date.now() + 60_000;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    let response: Response;
    try {
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) {
        throw new StorageError('Remote image download timed out', {
          retryable: true,
          diagnostic: {
            category: 'remote_download_timeout',
            hostname: safeRemoteHostname(nextUrl),
          },
        });
      }
      response = await fetch(nextUrl, {
        signal: AbortSignal.timeout(remainingMs),
        redirect: 'manual',
      });
    } catch (err) {
      if (err instanceof StorageError) throw err;
      const timedOut =
        err instanceof Error &&
        (err.name === 'TimeoutError' || err.name === 'AbortError');
      throw new StorageError(
        timedOut
          ? 'Remote image download timed out'
          : 'Failed to download remote image',
        {
          retryable: true,
          diagnostic: {
            category: timedOut
              ? 'remote_download_timeout'
              : 'remote_download_failed',
            hostname: safeRemoteHostname(nextUrl),
          },
        },
      );
    }
    if (response.status < 300 || response.status >= 400) return response;
    if (redirects === 3) {
      await cancelResponseBody(response);
      throw new StorageError('Remote image redirected too many times');
    }
    const location = response.headers.get('location');
    await cancelResponseBody(response);
    if (!location) throw new StorageError('Remote image redirect is invalid');
    try {
      nextUrl = await validateRemoteImageUrl(new URL(location, nextUrl).toString(), options);
    } catch (err) {
      if (err instanceof RemoteImageUrlError) {
        throw new StorageError('Remote image redirect is not allowed', {
          diagnostic: storageDiagnosticForUrlError(err),
        });
      }
      throw new StorageError('Remote image redirect could not be validated', {
        diagnostic: { category: 'remote_url_invalid' },
      });
    }
  }
  throw new StorageError('Remote image redirected too many times');
}

export async function downloadAndStore(
  url: string,
  options: DownloadAndStoreOptions = {},
): Promise<DownloadAndStoreResult> {
  ensureRootExists();
  if (isStagedImageRef(url)) return materializeStagedImage(url);
  if (url.startsWith(STAGING_PREFIX)) {
    throw new StorageError('Invalid staged image reference');
  }

  if (url.startsWith('data:')) {
    const staged = stageInlineImage(url);
    try {
      return materializeStagedImage(staged.reference);
    } finally {
      removeStagedImage(staged.reference);
    }
  }

  const response = await fetchRemoteImage(url, options);
  if (!response.ok) {
    await cancelResponseBody(response);
    throw new StorageError('Remote image download was rejected', {
      retryable: response.status === 429 || response.status >= 500,
      retryAfterMs: parseRetryAfterMs(response),
      diagnostic: {
        category: 'remote_http_rejected',
        hostname: safeRemoteHostname(url),
      },
    });
  }
  const hostname = safeRemoteHostname(url);
  let sourcePath: string | null = null;
  try {
    sourcePath = temporaryPath();
    const written = await writeResponseToTemporary(response, sourcePath);
    // Provider CDNs do not consistently preserve Content-Type through
    // watermarking and signed-URL layers. The allowlisted binary signature is
    // authoritative, so a valid image remains usable even when its HTTP
    // metadata says application/octet-stream or names another image format.
    const contentType = imageContentTypeFromMagic(written.prefix);
    if (!contentType) {
      throw new StorageError('Remote image binary signature is not supported', {
        diagnostic: { category: 'remote_content_invalid', hostname },
      });
    }
    return moveTemporaryImage(sourcePath, contentType);
  } catch (err) {
    if (sourcePath) removeTemporaryFile(sourcePath);
    else await cancelResponseBody(response);
    if (err instanceof StorageError) {
      if (err.diagnostic) throw err;
      const localWriteFailure =
        err.message === 'Failed to write remote image data' ||
        err.message === 'Failed to finalize stored image';
      throw new StorageError(err.message, {
        cause: err.cause,
        retryable: err.retryable,
        retryAfterMs: err.retryAfterMs,
        diagnostic: {
          category: localWriteFailure
            ? 'local_write_failed'
            : err.retryable
              ? 'remote_download_failed'
              : 'remote_content_invalid',
          ...(!localWriteFailure && hostname ? { hostname } : {}),
        },
      });
    }
    throw new StorageError('Failed to store remote image', {
      cause: err,
      diagnostic: { category: 'local_write_failed' },
    });
  }
}

function isMp4(prefix: BytePrefix): boolean {
  return prefix.byteLength >= 12 &&
    String.fromCharCode(...prefix.slice(4, 8)) === 'ftyp';
}

/** Streams a Provider video through the same URL/DNS/redirect safety boundary. */
export async function downloadAndStoreVideo(
  url: string,
  options: DownloadAndStoreOptions = {},
): Promise<DownloadAndStoreResult> {
  ensureRootExists();
  const response = await fetchRemoteImage(url, options);
  if (!response.ok) {
    await cancelResponseBody(response);
    throw new StorageError('Remote video download was rejected', {
      retryable: response.status === 429 || response.status >= 500,
      retryAfterMs: parseRetryAfterMs(response),
      diagnostic: {
        category: 'remote_http_rejected',
        hostname: safeRemoteHostname(url),
      },
    });
  }
  const hostname = safeRemoteHostname(url);
  let sourcePath: string | null = null;
  try {
    sourcePath = temporaryPath();
    const written = await writeResponseToTemporary(response, sourcePath, MAX_VIDEO_BYTES);
    if (!isMp4(written.prefix)) {
      throw new StorageError('Remote video binary signature is not supported', {
        diagnostic: { category: 'remote_content_invalid', hostname },
      });
    }
    return moveTemporaryImage(sourcePath, 'video/mp4');
  } catch (err) {
    if (sourcePath) removeTemporaryFile(sourcePath);
    else await cancelResponseBody(response);
    if (err instanceof StorageError) throw err;
    throw new StorageError('Failed to store remote video', {
      cause: err,
      diagnostic: { category: 'local_write_failed' },
    });
  }
}

/** Best-effort cleanup for a file that lost an idempotent image insert race. */
export function removeStoredFile(storagePath: string): void {
  ensureRootExists();
  const absolutePath = resolveStoragePath(storagePath);
  try {
    fs.rmSync(absolutePath, { force: true });
  } catch (err) {
    throw new StorageError(`Failed to remove stored image ${storagePath}`, { cause: err });
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
