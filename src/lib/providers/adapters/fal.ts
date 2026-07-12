import type {
  ImageProvider,
  NormalizedRequest,
  ProviderCapabilities,
  ProviderImageRef,
  SubmitResult,
  PollResult,
  JobHandle,
} from '../types';
import { getJson, postJson, putJson, ProviderHttpError, createProviderError } from '../http-client';
import { falCapabilities } from '../capabilities/fal';

function resolveSize(req: NormalizedRequest): string {
  if (typeof req.providerOptions?.image_size === 'string') {
    return req.providerOptions.image_size;
  }
  // fal flux/schnell uses enum sizes; ignore pixel width/height and aspectRatio here.
  return 'square_hd';
}

function buildRequestBody(req: NormalizedRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: req.prompt,
  };

  if (req.count && req.count > 1) {
    body.num_images = req.count;
  }
  if (req.seed !== undefined) {
    body.seed = req.seed;
  }

  body.image_size = resolveSize(req);

  for (const [key, value] of Object.entries(req.providerOptions ?? {})) {
    if (key !== 'image_size') {
      body[key] = value;
    }
  }

  return body;
}

function parseImages(payload: unknown): ProviderImageRef[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = payload as Record<string, unknown>;
  const rawImages = data.images;
  if (!Array.isArray(rawImages)) return [];

  return rawImages.map((item, idx) => {
    const img = item as Record<string, unknown>;
    const width = typeof img.width === 'number' ? img.width : null;
    const height = typeof img.height === 'number' ? img.height : null;
    const contentType =
      typeof img.content_type === 'string'
        ? img.content_type
        : typeof img.contentType === 'string'
          ? img.contentType
          : 'image/png';
    return {
      url: String(img.url ?? ''),
      width,
      height,
      contentType,
      index: idx,
    };
  });
}

export class FalProvider implements ImageProvider {
  id = 'fal' as const;
  displayName = 'fal.ai';
  capabilities = new Map<string, ProviderCapabilities>(
    falCapabilities.map((c) => [c.model, c]),
  );

  private get apiKey(): string | undefined {
    return process.env.FAL_KEY;
  }

  private authHeaders(): Record<string, string> {
    const key = this.apiKey;
    return key ? { Authorization: `Key ${key}` } : {};
  }

  async submit(req: NormalizedRequest, model: string): Promise<SubmitResult> {
    const url = `https://queue.fal.run/${model}`;
    try {
      const body = buildRequestBody(req);
      const data = (await postJson(url, body, this.authHeaders())) as Record<
        string,
        string
      >;

      const handle: JobHandle = {
        providerId: 'fal',
        model,
        externalId: data.request_id,
        statusUrl: data.status_url,
        responseUrl: data.response_url,
        cancelUrl: data.cancel_url ?? null,
        submittedAt: new Date().toISOString(),
      };

      return { kind: 'async', handle };
    } catch (err) {
      return { kind: 'failed', error: this.mapError(err) };
    }
  }

  async poll(handle: JobHandle): Promise<PollResult> {
    try {
      const statusData = (await getJson(
        handle.statusUrl,
        this.authHeaders(),
        15_000,
      )) as Record<string, unknown>;
      const status = String(statusData.status ?? '').toUpperCase();

      if (status === 'IN_QUEUE') return { status: 'pending' };
      if (status === 'IN_PROGRESS') return { status: 'running' };
      if (status !== 'COMPLETED') {
        return {
          status: 'failed',
          error: createProviderError(
            500,
            `Unexpected fal status: ${status}`,
            false,
          ),
        };
      }

      const responseData = (await getJson(
        handle.responseUrl,
        this.authHeaders(),
        15_000,
      )) as Record<string, unknown>;
      const images = parseImages(responseData);
      if (images.length === 0) {
        return {
          status: 'failed',
          error: createProviderError(500, 'No images in fal response', false),
        };
      }
      return { status: 'completed', images };
    } catch (err) {
      return { status: 'failed', error: this.mapError(err) };
    }
  }

  async cancel(handle: JobHandle): Promise<PollResult> {
    if (!handle.cancelUrl) {
      return {
        status: 'failed',
        error: createProviderError(400, 'Cancel URL not available', false),
      };
    }

    try {
      await putJson(handle.cancelUrl, this.authHeaders(), 15_000);
      return { status: 'cancelled' };
    } catch (err) {
      return { status: 'failed', error: this.mapError(err) };
    }
  }

  private mapError(err: unknown): ReturnType<typeof createProviderError> {
    if (err instanceof ProviderHttpError) {
      const message =
        typeof err.body === 'object' && err.body && 'detail' in err.body
          ? String((err.body as Record<string, unknown>).detail)
          : err.message;
      return createProviderError(err.status, message, err.status === 429);
    }
    if (err instanceof Error && err.name === 'TimeoutError') {
      return createProviderError(0, err.message, true);
    }
    return createProviderError(0, err instanceof Error ? err.message : String(err), false);
  }
}
