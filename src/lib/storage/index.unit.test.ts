import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  downloadAndStore,
  getReadStream,
  MAX_IMAGE_BYTES,
  removeStagedImage,
  removeStoredFile,
  stageInlineImage,
} from './index';
import { NotFoundError, StorageError } from '../errors';

describe('storage', () => {
  let tempDir: string;
  const originalEnv = process.env.LOCAL_STORAGE_DIR;
  const originalFetch = global.fetch;
  const imageBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...Buffer.from('fake-png-payload'),
  ]);
  const imageDataUrl = `data:image/png;base64,${imageBuffer.toString('base64')}`;
  const publicResolver = async () => ['93.184.216.34'];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
    process.env.LOCAL_STORAGE_DIR = tempDir;
  });

  afterEach(() => {
    process.env.LOCAL_STORAGE_DIR = originalEnv;
    global.fetch = originalFetch;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('downloads and stores an image with metadata', async () => {
    const url = 'https://cdn.example.com/image.png';
    global.fetch = vi.fn().mockResolvedValue(new Response(imageBuffer, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }));

    const result = await downloadAndStore(url, { resolveHostname: publicResolver });

    expect(result.contentType).toBe('image/png');
    expect(result.sizeBytes).toBe(imageBuffer.length);
    expect(result.storagePath).toMatch(/^\d{4}\/\d{2}\/[\w-]+\.png$/);

    const absolutePath = path.join(tempDir, result.storagePath);
    expect(fs.existsSync(absolutePath)).toBe(true);
    expect(fs.readFileSync(absolutePath)).toEqual(imageBuffer);
    expect(vi.mocked(global.fetch).mock.calls[0]?.[1]).toMatchObject({
      redirect: 'manual',
    });
  });

  it('does not compare decoded bytes with a compressed Content-Length', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(imageBuffer, {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'content-encoding': 'gzip',
        'content-length': '5',
      },
    }));

    const result = await downloadAndStore('https://cdn.example.com/image.png', {
      resolveHostname: publicResolver,
    });

    expect(fs.readFileSync(path.join(tempDir, result.storagePath))).toEqual(imageBuffer);
  });

  it('decodes and stores a Base64 image data URL', async () => {
    const result = await downloadAndStore(imageDataUrl);

    expect(result.contentType).toBe('image/png');
    expect(result.sizeBytes).toBe(imageBuffer.byteLength);
    const absolutePath = path.join(tempDir, result.storagePath);
    expect(fs.readFileSync(absolutePath)).toEqual(imageBuffer);
  });

  it('stages Base64 data behind an opaque reference before materializing it', async () => {
    const staged = stageInlineImage(imageDataUrl, 'image/png');
    expect(staged.reference).toMatch(/^staging:[0-9a-f-]{36}$/);
    expect(staged.reference).not.toContain('ZmFrZS');

    // Materializing is deliberately a copy, not a move. If the process dies
    // before the lifecycle transaction checkpoints the image row, the durable
    // result snapshot must still have a source that a later worker can use.
    const firstAttempt = await downloadAndStore(staged.reference);
    const secondAttempt = await downloadAndStore(staged.reference);

    expect(firstAttempt.contentType).toBe('image/png');
    expect(fs.readFileSync(path.join(tempDir, firstAttempt.storagePath))).toEqual(imageBuffer);
    expect(fs.readFileSync(path.join(tempDir, secondAttempt.storagePath))).toEqual(imageBuffer);

    removeStagedImage(staged.reference);
    await expect(downloadAndStore(staged.reference)).rejects.toBeInstanceOf(StorageError);
  });

  it('removes a staged image without permitting an arbitrary filesystem path', async () => {
    const staged = stageInlineImage(imageDataUrl, 'image/png');
    removeStagedImage(staged.reference);
    await expect(downloadAndStore(staged.reference)).rejects.toBeInstanceOf(StorageError);
  });

  it('throws StorageError when download fails', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));

    await expect(downloadAndStore('https://cdn.example.com/missing.png', {
      resolveHostname: publicResolver,
    })).rejects.toBeInstanceOf(StorageError);
  });

  it('throws StorageError on network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network failure'));
    await expect(downloadAndStore('https://cdn.example.com/image.png', {
      resolveHostname: publicResolver,
    })).rejects.toMatchObject({ retryable: true });
  });

  it('marks 5xx downloads retryable and keeps a bounded Retry-After', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, {
      status: 503,
      headers: { 'retry-after': '120' },
    }));

    await expect(downloadAndStore('https://cdn.example.com/image.png', {
      resolveHostname: publicResolver,
    })).rejects.toMatchObject({ retryable: true, retryAfterMs: 60_000 });
  });

  it('rejects a redirect to a loopback target before issuing the second request', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/private-image' },
    }));

    await expect(downloadAndStore('https://cdn.example.com/signed?token=secret', {
      resolveHostname: publicResolver,
    })).rejects.toThrow('Remote image redirect is not allowed');

    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it('rejects unsupported image signatures and removes its temporary file', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(Buffer.from('<html>not an image</html>'), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }));

    await expect(downloadAndStore('https://cdn.example.com/result.png', {
      resolveHostname: publicResolver,
    })).rejects.toThrow('binary signature');

    const temporaryRoot = path.join(tempDir, '.tmp');
    expect(fs.existsSync(temporaryRoot) ? fs.readdirSync(temporaryRoot) : []).toHaveLength(0);
  });

  it('cancels an advertised oversized image before opening a file', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'image/png',
        'content-length': String(MAX_IMAGE_BYTES + 1),
      }),
      body: { cancel },
    } as unknown as Response);

    await expect(downloadAndStore('https://cdn.example.com/result.png', {
      resolveHostname: publicResolver,
    })).rejects.toThrow('maximum allowed size');

    expect(cancel).toHaveBeenCalledOnce();
    const temporaryRoot = path.join(tempDir, '.tmp');
    expect(fs.existsSync(temporaryRoot) ? fs.readdirSync(temporaryRoot) : []).toHaveLength(0);
  });

  it('cancels a chunked oversized image and removes the partial temporary file', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_IMAGE_BYTES + 1));
      },
      cancel,
    });
    global.fetch = vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }));

    await expect(downloadAndStore('https://cdn.example.com/result.png', {
      resolveHostname: publicResolver,
    })).rejects.toThrow('maximum allowed size');

    expect(cancel).toHaveBeenCalledOnce();
    const temporaryRoot = path.join(tempDir, '.tmp');
    expect(fs.existsSync(temporaryRoot) ? fs.readdirSync(temporaryRoot) : []).toHaveLength(0);
  });

  it('cancels a short response and removes the partial temporary file', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const releaseLock = vi.fn();
    let readCount = 0;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'image/png',
        'content-length': String(imageBuffer.byteLength + 1),
      }),
      body: {
        getReader: () => ({
          read: vi.fn().mockImplementation(async () => {
            readCount += 1;
            return readCount === 1
              ? { done: false, value: imageBuffer }
              : { done: true, value: undefined };
          }),
          cancel,
          releaseLock,
        }),
      },
    } as unknown as Response);

    await expect(downloadAndStore('https://cdn.example.com/result.png', {
      resolveHostname: publicResolver,
    })).rejects.toMatchObject({ retryable: true });

    expect(cancel).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
    const temporaryRoot = path.join(tempDir, '.tmp');
    expect(fs.existsSync(temporaryRoot) ? fs.readdirSync(temporaryRoot) : []).toHaveLength(0);
  });

  it('cancels the response when the temporary directory cannot be created', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const getReader = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
      body: { cancel, getReader },
    } as unknown as Response);
    const mkdir = vi.spyOn(fs, 'mkdirSync').mockImplementationOnce(() => {
      throw new Error('disk unavailable');
    });

    try {
      await expect(downloadAndStore('https://cdn.example.com/result.png', {
        resolveHostname: publicResolver,
      })).rejects.toBeInstanceOf(StorageError);
    } finally {
      mkdir.mockRestore();
    }

    expect(cancel).toHaveBeenCalledOnce();
    expect(getReader).not.toHaveBeenCalled();
  });

  it('cancels the response when the temporary file cannot be opened', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const getReader = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
      body: { cancel, getReader },
    } as unknown as Response);
    const open = vi.spyOn(fs, 'openSync').mockImplementationOnce(() => {
      throw new Error('disk unavailable');
    });

    try {
      await expect(downloadAndStore('https://cdn.example.com/result.png', {
        resolveHostname: publicResolver,
      })).rejects.toBeInstanceOf(StorageError);
    } finally {
      open.mockRestore();
    }

    expect(cancel).toHaveBeenCalledOnce();
    expect(getReader).not.toHaveBeenCalled();
    const temporaryRoot = path.join(tempDir, '.tmp');
    expect(fs.existsSync(temporaryRoot) ? fs.readdirSync(temporaryRoot) : []).toHaveLength(0);
  });

  it('does not expose signed URL query parameters in download errors', async () => {
    const signedUrl = 'https://cdn.example.com/result.png?token=secret-value';
    global.fetch = vi.fn().mockRejectedValue(new Error(`network failure for ${signedUrl}`));

    let failure: unknown;
    try {
      await downloadAndStore(signedUrl, { resolveHostname: publicResolver });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toContain('secret-value');
    expect((failure as Error).message).not.toContain('cdn.example.com');
  });

  it('returns a readable stream for stored image', async () => {
    const imageBuffer = Buffer.from('stream-test');
    const storagePath = '2026/07/test.png';
    const absolutePath = path.join(tempDir, storagePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, imageBuffer);

    const stream = getReadStream(storagePath);
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const result = Buffer.concat(chunks as unknown as Uint8Array[]);
    expect(result.toString()).toBe('stream-test');
  });

  it('throws NotFoundError for missing file', () => {
    expect(() => getReadStream('2026/07/missing.png')).toThrow(NotFoundError);
  });

  it('throws StorageError for path traversal attempt', () => {
    expect(() => getReadStream('../../../etc/passwd')).toThrow(StorageError);
  });

  it('removes a stored file within the storage root', () => {
    const storagePath = '2026/07/loser.png';
    const absolutePath = path.join(tempDir, storagePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, 'loser');

    removeStoredFile(storagePath);

    expect(fs.existsSync(absolutePath)).toBe(false);
    expect(() => removeStoredFile('../../../etc/passwd')).toThrow(StorageError);
  });
});
