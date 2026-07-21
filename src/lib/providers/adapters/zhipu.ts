import type {
  ImageProvider,
  NormalizedRequest,
  ProviderImageRef,
  SubmitResult,
} from '../types';
import {
  postJson,
  ProviderHttpError,
  createProviderError,
  createProviderErrorFromHttpError,
} from '../http-client';
import { zhipuModelSpecs, type ZhipuImageProfile } from '../capabilities/zhipu';
import {
  modelCapabilityMap,
  unsupportedModelSubmitResult,
} from '../model-spec';
import { resolveCredential } from '../../user-config';
import { resolveSyncImageGenerationTimeoutMs } from '../timeout-policy';
import {
  classifyProviderDiagnostic,
  readProviderRequestIdFromResponse,
} from '../error-diagnostics';

const API_URL = 'https://open.bigmodel.cn/api/paas/v4/images/generations';
const RESERVED_KEYS = new Set([
  'model',
  'prompt',
  'size',
  'quality',
  'watermark_enabled',
  'user_id',
  'negative_prompt',
  'seed',
]);

function resolveSize(req: NormalizedRequest, profile: ZhipuImageProfile): string {
  if (req.width && req.height) return `${req.width}x${req.height}`;
  return profile.aspectRatioSizes[req.aspectRatio ?? ''] ?? profile.defaultSize;
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
  profile: ZhipuImageProfile,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    prompt: req.prompt,
    quality: 'hd',
    size: resolveSize(req, profile),
    watermark_enabled: true,
    user_id: process.env.ZHIPU_USER_ID ?? 'local-user',
  };

  for (const [key, value] of Object.entries(req.providerOptions ?? {})) {
    if (!RESERVED_KEYS.has(key)) body[key] = value;
  }
  return body;
}

function parseImages(payload: unknown, size: string): ProviderImageRef[] {
  if (!payload || typeof payload !== 'object') return [];
  const rawData = (payload as Record<string, unknown>).data;
  if (!Array.isArray(rawData)) return [];
  const dimensions = parseDimensions(size);

  return rawData.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const image = item as Record<string, unknown>;
    if (typeof image.url !== 'string' || image.url.length === 0) return [];
    return [{
      url: image.url,
      width: dimensions.width,
      height: dimensions.height,
      contentType: 'image/png',
      index,
    }];
  });
}

export class ZhipuProvider implements ImageProvider {
  id = 'zhipu' as const;
  displayName = 'Zhipu AI';
  capabilities = modelCapabilityMap(zhipuModelSpecs);

  private authHeaders(): Record<string, string> {
    const key = resolveCredential('ZHIPU_API_KEY');
    return key ? { Authorization: `Bearer ${key}` } : {};
  }

  async submit(req: NormalizedRequest, model: string): Promise<SubmitResult> {
    const spec = zhipuModelSpecs.get(model);
    if (!spec) return unsupportedModelSubmitResult(this.id);

    try {
      const size = resolveSize(req, spec.profile);
      const data = await postJson(
        API_URL,
        buildRequestBody(req, model, spec.profile),
        this.authHeaders(),
        { timeoutMs: resolveSyncImageGenerationTimeoutMs() },
      );
      const images = parseImages(data, size);
      if (images.length === 0) {
        return {
          kind: 'failed',
          error: createProviderError(500, 'No images in Zhipu response', false, {
            diagnostic: classifyProviderDiagnostic('zhipu', { noResult: true }),
          }),
        };
      }
      return { kind: 'sync', images };
    } catch (err) {
      return { kind: 'failed', error: this.mapError(err) };
    }
  }

  private mapError(err: unknown): ReturnType<typeof createProviderError> {
    if (err instanceof ProviderHttpError) {
      const body = err.body as Record<string, unknown> | null;
      const errorBody =
        body && body.error && typeof body.error === 'object'
          ? (body.error as Record<string, unknown>)
          : null;
      const message =
        errorBody && typeof errorBody.message === 'string'
          ? errorBody.message
          : err.message;
      return createProviderErrorFromHttpError(err, message, {
        diagnostic: classifyProviderDiagnostic('zhipu', {
          httpStatus: err.status,
          providerCode: errorBody?.code,
          providerRequestId: readProviderRequestIdFromResponse(err.body, [
            err.getHeader('x-request-id'),
          ]),
          transportTimeout: err.status === 0 && err.retryable,
        }),
      });
    }
    if (err instanceof Error && err.name === 'TimeoutError') {
      return createProviderError(0, err.message, true, {
        disposition: 'unknown',
        diagnostic: classifyProviderDiagnostic('zhipu', { transportTimeout: true }),
      });
    }
    return createProviderError(
      0,
      err instanceof Error ? err.message : String(err),
      false,
      { diagnostic: classifyProviderDiagnostic('zhipu') },
    );
  }
}
