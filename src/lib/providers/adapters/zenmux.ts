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

type OpenAiImageProfile = Extract<ZenmuxImageProfile, { kind: 'openai-images' }>;
type GeminiImageProfile = Extract<
  ZenmuxImageProfile,
  { kind: 'gemini-generate-content' }
>;

function resolveSize(req: NormalizedRequest, profile: OpenAiImageProfile): string {
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
  profile: OpenAiImageProfile,
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

function geminiEndpoint(profile: GeminiImageProfile): string {
  return `https://zenmux.ai/api/vertex-ai/v1/publishers/${profile.publisher}/models/${profile.apiModel}:generateContent`;
}

function buildGeminiRequestBody(
  req: NormalizedRequest,
  profile: GeminiImageProfile,
): Record<string, unknown> {
  const requestedSize = req.providerOptions?.imageSize;
  const imageSize =
    typeof requestedSize === 'string' &&
    profile.supportedImageSizes.includes(requestedSize)
      ? requestedSize
      : profile.defaultImageSize;
  return {
    contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio: req.aspectRatio ?? profile.defaultAspectRatio,
        imageSize,
      },
    },
  };
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
      source: url ? 'remote' as const : 'inline' as const,
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

function parseGeminiImages(payload: unknown): ProviderImageRef[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const candidates = (payload as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates)) return [];
  const images: ProviderImageRef[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const content = (candidate as Record<string, unknown>).content;
    if (!content || typeof content !== 'object' || Array.isArray(content)) continue;
    const parts = (content as Record<string, unknown>).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (!part || typeof part !== 'object' || Array.isArray(part)) continue;
      const record = part as Record<string, unknown>;
      const inline = record.inlineData ?? record.inline_data;
      if (!inline || typeof inline !== 'object' || Array.isArray(inline)) continue;
      const inlineRecord = inline as Record<string, unknown>;
      const data = inlineRecord.data;
      if (typeof data !== 'string' || data.length === 0) continue;
      const mimeType = inlineRecord.mimeType ?? inlineRecord.mime_type;
      const contentType =
        typeof mimeType === 'string' && mimeType.startsWith('image/')
          ? mimeType
          : 'image/png';
      images.push({
        source: 'inline',
        url: `data:${contentType};base64,${data}`,
        width: null,
        height: null,
        contentType,
        index: images.length,
      });
    }
  }
  return images;
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

    try {
      const isGemini = spec.profile.kind === 'gemini-generate-content';
      const url = isGemini
        ? geminiEndpoint(spec.profile)
        : 'https://zenmux.ai/api/v1/images/generations';
      const body = isGemini
        ? buildGeminiRequestBody(req, spec.profile)
        : buildRequestBody(req, model, spec.profile);
      const data = await postJsonWithInlineImageResponse(
        url,
        body,
        this.authHeaders(),
        { timeoutMs: resolveSyncImageGenerationTimeoutMs() },
      );
      const images = isGemini ? parseGeminiImages(data) : parseImages(data);
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
