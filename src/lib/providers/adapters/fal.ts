import type {
  ImageProvider,
  NormalizedRequest,
  ProviderCapabilities,
  ProviderImageRef,
  SubmitResult,
  PollResult,
  JobHandle,
} from '../types';
import {
  createProviderError,
  createProviderErrorFromHttpError,
  getJson,
  postJson,
  ProviderHttpError,
  putJson,
} from '../http-client';
import { falCapabilities } from '../capabilities/fal';
import {
  providerEndpointUrl,
  trustedProviderBaseUrl,
  trustedProviderExternalId,
  trustedSameOriginProviderUrl,
} from '../endpoint-policy';
import { resolveCredential } from '../../user-config';

const DEFAULT_FAL_BASE_URL = 'https://queue.fal.run';

function falBaseUrl(): URL {
  return trustedProviderBaseUrl(process.env.FAL_BASE_URL ?? DEFAULT_FAL_BASE_URL);
}

function queueUrl(model: string): string {
  return providerEndpointUrl(falBaseUrl(), model.split('/'));
}

function falHandle(
  payload: unknown,
  model: string,
): JobHandle | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const data = payload as Record<string, unknown>;
  try {
    const base = falBaseUrl();
    const externalId = trustedProviderExternalId(data.request_id);
    const statusUrl = trustedSameOriginProviderUrl(data.status_url, base.origin);
    const responseUrl = trustedSameOriginProviderUrl(data.response_url, base.origin);
    const cancelUrl =
      data.cancel_url === null || data.cancel_url === undefined
        ? null
        : trustedSameOriginProviderUrl(data.cancel_url, base.origin);
    return {
      providerId: 'fal',
      model,
      externalId,
      statusUrl,
      responseUrl,
      cancelUrl,
      submittedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function trustedFalHandleUrl(value: unknown): string {
  return trustedSameOriginProviderUrl(value, falBaseUrl().origin);
}

function resolveSize(req: NormalizedRequest): string {
  const aspectRatioMap: Record<string, string> = {
    '1:1': 'square_hd',
    '4:3': 'landscape_4_3',
    '3:4': 'portrait_4_3',
    '16:9': 'landscape_16_9',
    '9:16': 'portrait_16_9',
  };

  if (req.aspectRatio && aspectRatioMap[req.aspectRatio]) {
    return aspectRatioMap[req.aspectRatio];
  }

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
    return resolveCredential('FAL_KEY');
  }

  private authHeaders(): Record<string, string> {
    const key = this.apiKey;
    return key ? { Authorization: `Key ${key}` } : {};
  }

  async submit(req: NormalizedRequest, model: string): Promise<SubmitResult> {
    try {
      const body = buildRequestBody(req);
      const data = await postJson(queueUrl(model), body, this.authHeaders());
      const handle = falHandle(data, model);
      if (!handle) {
        return {
          kind: 'failed',
          error: createProviderError(
            500,
            'Fal returned an invalid task reference',
            false,
            { disposition: 'unknown' },
          ),
        };
      }

      return { kind: 'async', handle };
    } catch (err) {
      return { kind: 'failed', error: this.mapError(err) };
    }
  }

  async poll(handle: JobHandle): Promise<PollResult> {
    let statusUrl: string;
    let responseUrl: string;
    try {
      statusUrl = trustedFalHandleUrl(handle.statusUrl);
      responseUrl = trustedFalHandleUrl(handle.responseUrl);
    } catch {
      return {
        status: 'failed',
        error: createProviderError(400, 'Fal task endpoint is invalid', false),
      };
    }
    try {
      const statusData = (await getJson(
        statusUrl,
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
        responseUrl,
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

    let cancelUrl: string;
    try {
      cancelUrl = trustedFalHandleUrl(handle.cancelUrl);
    } catch {
      return {
        status: 'failed',
        error: createProviderError(400, 'Fal cancel endpoint is invalid', false),
      };
    }
    try {
      await putJson(cancelUrl, this.authHeaders());
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
      return createProviderErrorFromHttpError(err, message);
    }
    if (err instanceof Error && err.name === 'TimeoutError') {
      return createProviderError(0, err.message, true, {
        disposition: 'unknown',
      });
    }
    return createProviderError(0, err instanceof Error ? err.message : String(err), false);
  }
}
