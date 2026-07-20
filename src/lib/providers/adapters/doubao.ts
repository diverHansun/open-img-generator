import type {
  ImageProvider,
  NormalizedRequest,
  ProviderCapabilities,
  ProviderImageRef,
  SubmitResult,
} from '../types';
import {
  createProviderError,
  createProviderErrorFromHttpError,
  postJsonWithInlineImageResponse,
  ProviderHttpError,
} from '../http-client';
import { doubaoCapabilities } from '../capabilities/doubao';
import { resolveCredential } from '../../user-config';
import { resolveSyncImageGenerationTimeoutMs } from '../timeout-policy';
import {
  classifyProviderDiagnostic,
  readProviderRequestIdFromResponse,
} from '../error-diagnostics';

const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const RESERVED_KEYS = new Set([
  'model',
  'prompt',
  'image',
  'size',
  'seed',
  'sequential_image_generation',
  'stream',
  'response_format',
  'watermark',
]);

function apiUrl(): string {
  const base = process.env.ARK_BASE_URL ?? DEFAULT_BASE_URL;
  return `${base.replace(/\/+$/, '')}/images/generations`;
}

function resolveSize(req: NormalizedRequest): string {
  if (req.width && req.height) return `${req.width}x${req.height}`;

  const aspectRatioMap: Record<string, string> = {
    '1:1': '2048x2048',
    '3:2': '2048x1365',
    '2:3': '1365x2048',
    '4:3': '2048x1536',
    '3:4': '1536x2048',
    '16:9': '2048x1152',
    '9:16': '1152x2048',
  };
  return aspectRatioMap[req.aspectRatio ?? ''] ?? '2K';
}

function parseDimensions(size: string): { width: number | null; height: number | null } {
  const match = /^(\d+)x(\d+)$/.exec(size);
  return match
    ? { width: Number(match[1]), height: Number(match[2]) }
    : { width: null, height: null };
}

function contentTypeFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
    if (pathname.endsWith('.webp')) return 'image/webp';
  } catch {
    // Keep the API's documented JPEG default for non-URL references.
  }
  return 'image/jpeg';
}

function buildRequestBody(req: NormalizedRequest, model: string): Record<string, unknown> {
  const size = resolveSize(req);
  const body: Record<string, unknown> = {
    model,
    prompt: req.prompt,
    size,
    sequential_image_generation: 'disabled',
    stream: false,
    response_format: 'url',
    watermark: true,
  };
  if (req.seed !== undefined) body.seed = req.seed;
  if (req.referenceImages && req.referenceImages.length > 0) {
    body.image = req.referenceImages;
  }

  for (const [key, value] of Object.entries(req.providerOptions ?? {})) {
    if (!RESERVED_KEYS.has(key)) body[key] = value;
  }
  return body;
}

function parseImages(payload: unknown, requestedSize: string): ProviderImageRef[] {
  if (!payload || typeof payload !== 'object') return [];
  const rawData = (payload as Record<string, unknown>).data;
  if (!Array.isArray(rawData)) return [];
  const fallbackDimensions = parseDimensions(requestedSize);

  return rawData.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const image = item as Record<string, unknown>;
    const itemSize = typeof image.size === 'string' ? image.size : requestedSize;
    const dimensions = parseDimensions(itemSize);
    const url = typeof image.url === 'string' ? image.url : '';
    const base64 = typeof image.b64_json === 'string' ? image.b64_json : '';
    const contentType =
      typeof image.content_type === 'string'
        ? image.content_type
        : base64
          ? 'image/jpeg'
          : url
            ? contentTypeFromUrl(url)
            : 'image/jpeg';
    if (!url && !base64) return [];
    return [{
      url: url || `data:${contentType};base64,${base64}`,
      width: dimensions.width ?? fallbackDimensions.width,
      height: dimensions.height ?? fallbackDimensions.height,
      contentType,
      index,
    }];
  });
}

export class DoubaoProvider implements ImageProvider {
  id = 'doubao' as const;
  displayName = 'Doubao';
  capabilities = new Map<string, ProviderCapabilities>(
    doubaoCapabilities.map((capability) => [capability.model, capability]),
  );

  private authHeaders(): Record<string, string> {
    const key = resolveCredential('ARK_API_KEY');
    return key ? { Authorization: `Bearer ${key}` } : {};
  }

  async submit(req: NormalizedRequest, model: string): Promise<SubmitResult> {
    try {
      const data = await postJsonWithInlineImageResponse(
        apiUrl(),
        buildRequestBody(req, model),
        this.authHeaders(),
        { timeoutMs: resolveSyncImageGenerationTimeoutMs() },
      );
      const images = parseImages(data, resolveSize(req));
      if (images.length === 0) {
        return {
          kind: 'failed',
          error: createProviderError(500, 'No images in Doubao response', false, {
            diagnostic: classifyProviderDiagnostic('doubao', { noResult: true }),
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
      const nestedError =
        body && body.error && typeof body.error === 'object'
          ? (body.error as Record<string, unknown>)
          : null;
      const message =
        nestedError && typeof nestedError.message === 'string'
          ? nestedError.message
          : body && typeof body.message === 'string'
            ? body.message
            : typeof err.body === 'string'
              ? err.body
            : err.message;
      return createProviderErrorFromHttpError(err, message, {
        diagnostic: classifyProviderDiagnostic('doubao', {
          httpStatus: err.status,
          providerCode: nestedError?.code,
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
        diagnostic: classifyProviderDiagnostic('doubao', { transportTimeout: true }),
      });
    }
    return createProviderError(0, err instanceof Error ? err.message : String(err), false, {
      diagnostic: classifyProviderDiagnostic('doubao'),
    });
  }
}
