import type {
  ImageProvider,
  NormalizedRequest,
  ProviderImageRef,
  SubmitResult,
} from '../types';
import {
  createProviderError,
  createProviderErrorFromHttpError,
  postJsonWithInlineImageResponse,
  ProviderHttpError,
} from '../http-client';
import {
  zenmuxModelSpecs,
  type ZenmuxImageProfile,
} from '../capabilities/zenmux';
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

function resolveSize(req: NormalizedRequest, profile: ZenmuxImageProfile): string {
  if (req.width && req.height) {
    return `${req.width}x${req.height}`;
  }

  if (req.aspectRatio && profile.aspectRatioSizes[req.aspectRatio]) {
    return profile.aspectRatioSizes[req.aspectRatio];
  }

  return profile.defaultSize;
}

function buildRequestBody(
  req: NormalizedRequest,
  model: string,
  profile: ZenmuxImageProfile,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: req.prompt,
    model,
    n: req.count ?? 1,
    size: resolveSize(req, profile),
  };

  for (const [key, value] of Object.entries(req.providerOptions ?? {})) {
    if (profile.allowedProviderOptions.includes(key)) {
      body[key] = value;
    }
  }

  return body;
}

function parseImages(payload: unknown): ProviderImageRef[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = payload as Record<string, unknown>;
  const rawData = data.data;
  if (!Array.isArray(rawData)) return [];

  const outputFormat = typeof data.output_format === 'string' ? data.output_format : 'png';
  const formatContentType: Record<string, string> = {
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  };

  return rawData.map((item, idx) => {
    const img = item as Record<string, unknown>;
    const url = typeof img.url === 'string' ? img.url : '';
    const base64 = typeof img.b64_json === 'string' ? img.b64_json : '';
    const contentType =
      typeof img.content_type === 'string'
        ? img.content_type
        : formatContentType[outputFormat] ?? 'image/png';
    return {
      // ZenMux GPT image models return b64_json by default. Keeping it as a
      // data URL lets the shared storage layer persist both URL and Base64
      // provider responses without leaking provider-specific logic into it.
      url: url || (base64 ? `data:${contentType};base64,${base64}` : ''),
      width: null,
      height: null,
      contentType,
      index: idx,
      revisedPrompt:
        typeof img.revised_prompt === 'string' ? img.revised_prompt : undefined,
    };
  });
}

export class ZenmuxProvider implements ImageProvider {
  id = 'zenmux' as const;
  displayName = 'ZenMux';
  capabilities = modelCapabilityMap(zenmuxModelSpecs);

  private get apiKey(): string | undefined {
    return resolveCredential('ZENMUX_API_KEY');
  }

  private authHeaders(): Record<string, string> {
    const key = this.apiKey;
    return key ? { Authorization: `Bearer ${key}` } : {};
  }

  async submit(req: NormalizedRequest, model: string): Promise<SubmitResult> {
    const spec = zenmuxModelSpecs.get(model);
    if (!spec) return unsupportedModelSubmitResult(this.id);

    const url = 'https://zenmux.ai/api/v1/images/generations';
    try {
      const body = buildRequestBody(req, model, spec.profile);
      const data = await postJsonWithInlineImageResponse(
        url,
        body,
        this.authHeaders(),
        { timeoutMs: resolveSyncImageGenerationTimeoutMs() },
      );
      const images = parseImages(data);
      if (images.length === 0) {
        return {
          kind: 'failed',
          error: createProviderError(500, 'No images in zenmux response', false, {
            diagnostic: classifyProviderDiagnostic('zenmux', { noResult: true }),
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
      const providerError =
        body && body.error && typeof body.error === 'object'
          ? (body.error as Record<string, unknown>)
          : null;
      const message =
        providerError
          ? String(providerError.message ?? err.message)
          : err.message;
      return createProviderErrorFromHttpError(err, message, {
        diagnostic: classifyProviderDiagnostic('zenmux', {
          httpStatus: err.status,
          providerCode: providerError?.type,
          providerRequestId: readProviderRequestIdFromResponse(err.body, [
            err.getHeader('x-zenmux-requestid'),
            err.getHeader('x-request-id'),
          ]),
          transportTimeout: err.status === 0 && err.retryable,
        }),
      });
    }
    if (err instanceof Error && err.name === 'TimeoutError') {
      return createProviderError(0, err.message, true, {
        disposition: 'unknown',
        diagnostic: classifyProviderDiagnostic('zenmux', { transportTimeout: true }),
      });
    }
    return createProviderError(0, err instanceof Error ? err.message : String(err), false, {
      diagnostic: classifyProviderDiagnostic('zenmux'),
    });
  }
}
