import type {
  ImageProvider,
  NormalizedRequest,
  ProviderCapabilities,
  ProviderImageRef,
  SubmitResult,
} from '../types';
import {
  postJson,
  ProviderHttpError,
  createProviderError,
  createProviderErrorFromHttpError,
} from '../http-client';
import { siliconflowCapabilities } from '../capabilities/siliconflow';
import { resolveCredential } from '../../user-config';

const API_URL = 'https://api.siliconflow.cn/v1/images/generations';
const RESERVED_KEYS = new Set([
  'model',
  'prompt',
  'image_size',
  'batch_size',
  'negative_prompt',
  'seed',
]);

function resolveSize(req: NormalizedRequest): string {
  if (req.width && req.height) return `${req.width}x${req.height}`;

  const aspectRatioMap: Record<string, string> = {
    '1:1': '1024x1024',
    '3:4': '960x1280',
    '1:2': '720x1440',
    '9:16': '720x1280',
  };
  return aspectRatioMap[req.aspectRatio ?? ''] ?? '1024x1024';
}

function parseDimensions(size: string): { width: number | null; height: number | null } {
  const match = /^(\d+)x(\d+)$/.exec(size);
  return match
    ? { width: Number(match[1]), height: Number(match[2]) }
    : { width: null, height: null };
}

function buildRequestBody(
  req: NormalizedRequest,
  model: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    prompt: req.prompt,
    image_size: resolveSize(req),
    batch_size: req.count ?? 1,
  };
  if (req.negativePrompt) body.negative_prompt = req.negativePrompt;
  if (req.seed !== undefined) body.seed = req.seed;

  for (const [key, value] of Object.entries(req.providerOptions ?? {})) {
    if (!RESERVED_KEYS.has(key)) body[key] = value;
  }
  return body;
}

function parseImages(payload: unknown, size: string): ProviderImageRef[] {
  if (!payload || typeof payload !== 'object') return [];
  const rawImages = (payload as Record<string, unknown>).images;
  if (!Array.isArray(rawImages)) return [];
  const dimensions = parseDimensions(size);

  return rawImages.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const image = item as Record<string, unknown>;
    if (typeof image.url !== 'string' || image.url.length === 0) return [];
    return [{
      url: image.url,
      width: typeof image.width === 'number' ? image.width : dimensions.width,
      height: typeof image.height === 'number' ? image.height : dimensions.height,
      contentType:
        typeof image.content_type === 'string' ? image.content_type : 'image/png',
      index,
    }];
  });
}

export class SiliconFlowProvider implements ImageProvider {
  id = 'siliconflow' as const;
  displayName = 'SiliconFlow';
  capabilities = new Map<string, ProviderCapabilities>(
    siliconflowCapabilities.map((capability) => [capability.model, capability]),
  );

  private authHeaders(): Record<string, string> {
    const key = resolveCredential('SILICONFLOW_API_KEY');
    return key ? { Authorization: `Bearer ${key}` } : {};
  }

  async submit(req: NormalizedRequest, model: string): Promise<SubmitResult> {
    try {
      const size = resolveSize(req);
      const data = await postJson(
        API_URL,
        buildRequestBody(req, model),
        this.authHeaders(),
      );
      const images = parseImages(data, size);
      if (images.length === 0) {
        return {
          kind: 'failed',
          error: createProviderError(500, 'No images in SiliconFlow response', false),
        };
      }
      return { kind: 'sync', images };
    } catch (err) {
      return { kind: 'failed', error: this.mapError(err) };
    }
  }

  private mapError(err: unknown): ReturnType<typeof createProviderError> {
    if (err instanceof ProviderHttpError) {
      if (typeof err.body === 'string' && err.body.length > 0) {
        return createProviderErrorFromHttpError(err, err.body);
      }
      const body = err.body as Record<string, unknown> | null;
      const message =
        body && typeof body.message === 'string'
          ? body.message
          : body && typeof body.data === 'string'
            ? body.data
            : err.message;
      return createProviderErrorFromHttpError(err, message);
    }
    if (err instanceof Error && err.name === 'TimeoutError') {
      return createProviderError(0, err.message, true, {
        disposition: 'unknown',
      });
    }
    return createProviderError(
      0,
      err instanceof Error ? err.message : String(err),
      false,
    );
  }
}
