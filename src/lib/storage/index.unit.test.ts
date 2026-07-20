import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  downloadAndStore,
  getReadStream,
  removeStagedImage,
  removeStoredFile,
  stageInlineImage,
} from './index';
import { NotFoundError, StorageError } from '../errors';

describe('storage', () => {
  let tempDir: string;
  const originalEnv = process.env.LOCAL_STORAGE_DIR;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
    process.env.LOCAL_STORAGE_DIR = tempDir;
  });

  afterEach(() => {
    process.env.LOCAL_STORAGE_DIR = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('downloads and stores an image with metadata', async () => {
    const imageBuffer = Buffer.from('fake-image-binary');
    const url = 'https://cdn.example.com/image.png';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: async () => imageBuffer.buffer.slice(imageBuffer.byteOffset, imageBuffer.byteOffset + imageBuffer.byteLength),
    } as unknown as Response);

    const result = await downloadAndStore(url);

    expect(result.contentType).toBe('image/png');
    expect(result.sizeBytes).toBe(imageBuffer.length);
    expect(result.storagePath).toMatch(/^\d{4}\/\d{2}\/[\w-]+\.png$/);

    const absolutePath = path.join(tempDir, result.storagePath);
    expect(fs.existsSync(absolutePath)).toBe(true);
    expect(fs.readFileSync(absolutePath).toString()).toBe('fake-image-binary');
  });

  it('decodes and stores a Base64 image data URL', async () => {
    const result = await downloadAndStore('data:image/png;base64,ZmFrZS1pbWFnZS1iaW5hcnk=');

    expect(result.contentType).toBe('image/png');
    expect(result.sizeBytes).toBe(Buffer.byteLength('fake-image-binary'));
    const absolutePath = path.join(tempDir, result.storagePath);
    expect(fs.readFileSync(absolutePath).toString()).toBe('fake-image-binary');
  });

  it('stages Base64 data behind an opaque reference before materializing it', async () => {
    const staged = stageInlineImage(
      'data:image/png;base64,ZmFrZS1pbWFnZS1iaW5hcnk=',
      'image/png',
    );
    expect(staged.reference).toMatch(/^staging:[0-9a-f-]{36}$/);
    expect(staged.reference).not.toContain('ZmFrZS');

    // Materializing is deliberately a copy, not a move. If the process dies
    // before the lifecycle transaction checkpoints the image row, the durable
    // result snapshot must still have a source that a later worker can use.
    const firstAttempt = await downloadAndStore(staged.reference);
    const secondAttempt = await downloadAndStore(staged.reference);

    expect(firstAttempt.contentType).toBe('image/png');
    expect(fs.readFileSync(path.join(tempDir, firstAttempt.storagePath)).toString())
      .toBe('fake-image-binary');
    expect(fs.readFileSync(path.join(tempDir, secondAttempt.storagePath)).toString())
      .toBe('fake-image-binary');

    removeStagedImage(staged.reference);
    await expect(downloadAndStore(staged.reference)).rejects.toBeInstanceOf(StorageError);
  });

  it('removes a staged image without permitting an arbitrary filesystem path', async () => {
    const staged = stageInlineImage('data:image/png;base64,ZmFrZQ==', 'image/png');
    removeStagedImage(staged.reference);
    await expect(downloadAndStore(staged.reference)).rejects.toBeInstanceOf(StorageError);
  });

  it('throws StorageError when download fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response);

    await expect(downloadAndStore('https://cdn.example.com/missing.png')).rejects.toBeInstanceOf(StorageError);
  });

  it('throws StorageError on network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network failure'));
    await expect(downloadAndStore('https://cdn.example.com/image.png')).rejects.toBeInstanceOf(StorageError);
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
