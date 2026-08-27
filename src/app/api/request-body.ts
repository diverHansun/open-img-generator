import { PayloadTooLargeError, ValidationError } from '../../lib/errors';

export const DEFAULT_MAX_JSON_BODY_BYTES = 512 * 1_024;

async function readBoundedJsonText(request: Request, maxBytes: number): Promise<string> {
  const advertisedLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(advertisedLength) && advertisedLength > maxBytes) {
    throw new PayloadTooLargeError('Request payload is too large');
  }
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new PayloadTooLargeError('Request payload is too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export async function readJsonObject(
  request: Request,
  options: { maxBytes?: number } = {},
): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = JSON.parse(
      await readBoundedJsonText(
        request,
        options.maxBytes ?? DEFAULT_MAX_JSON_BODY_BYTES,
      ),
    );
  } catch (error) {
    if (error instanceof PayloadTooLargeError) throw error;
    throw new ValidationError('Request body must be valid JSON');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}
