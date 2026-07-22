import type {
  ImageProvider,
  JobHandle,
  NormalizedRequest,
  PollResult,
  ProviderImageRef,
  ProviderVideoRef,
  SubmitResult,
} from '../types';
import {
  createProviderError,
  createProviderErrorFromHttpError,
  postJsonWithInlineImageResponse,
  postJson,
  getJson,
  ProviderHttpError,
} from '../http-client';
import {
  doubaoModelSpecs,
  type DoubaoImageProfile,
} from '../capabilities/doubao';
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
import {
  providerEndpointUrl,
  trustedProviderBaseUrl,
  trustedProviderExternalId,
} from '../endpoint-policy';

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

function baseUrl(): URL {
  return trustedProviderBaseUrl(process.env.ARK_BASE_URL ?? DEFAULT_BASE_URL);
}

function apiUrl(): string {
  return providerEndpointUrl(baseUrl(), ['images', 'generations']);
}

function videoTasksUrl(): string {
  return providerEndpointUrl(baseUrl(), ['contents', 'generations', 'tasks']);
}

function videoTaskUrl(taskId: string): string {
  return providerEndpointUrl(baseUrl(), [
    'contents',
    'generations',
    'tasks',
    trustedProviderExternalId(taskId),
  ]);
}

function resolveSize(
  req: NormalizedRequest,
  profile: Extract<DoubaoImageProfile, { kind: 'seedream-images' }>,
): string {
  if (req.width && req.height) return `${req.width}x${req.height}`;
  return profile.aspectRatioSizes[req.aspectRatio ?? ''] ?? profile.defaultSize;
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

function buildRequestBody(
  req: NormalizedRequest,
  model: string,
  profile: Extract<DoubaoImageProfile, { kind: 'seedream-images' }>,
): Record<string, unknown> {
  const size = resolveSize(req, profile);
  const body: Record<string, unknown> = {
    model,
    prompt: req.prompt,
    size,
    sequential_image_generation: 'disabled',
    stream: false,
    response_format: profile.responseFormat,
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

function buildVideoRequestBody(
  req: NormalizedRequest,
  model: string,
  profile: Extract<DoubaoImageProfile, { kind: 'seedance-video' }>,
): Record<string, unknown> {
  const ratio = req.aspectRatio ?? profile.defaultAspectRatio;
  return {
    model,
    content: [{ type: 'text', text: `${req.prompt} --ratio ${ratio}` }],
  };
}

function videoHandle(payload: unknown, model: string): JobHandle | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const id = (payload as Record<string, unknown>).id;
  if (typeof id !== 'string' || id.length === 0) return null;
  try {
    const url = videoTaskUrl(id);
    return {
      providerId: 'doubao',
      model,
      externalId: trustedProviderExternalId(id),
      statusUrl: url,
      responseUrl: url,
      cancelUrl: null,
      submittedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function parseVideo(payload: unknown): ProviderVideoRef[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const root = payload as Record<string, unknown>;
  const content = root.content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) return [];
  const url = (content as Record<string, unknown>).video_url;
  if (typeof url !== 'string' || url.length === 0) return [];
  return [{
    url,
    width: null,
    height: null,
    contentType: 'video/mp4',
    index: 0,
    durationSeconds: null,
  }];
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
      source: url ? 'remote' as const : 'inline' as const,
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
  capabilities = modelCapabilityMap(doubaoModelSpecs);

  private authHeaders(): Record<string, string> {
    const key = resolveCredential('ARK_API_KEY');
    return key ? { Authorization: `Bearer ${key}` } : {};
  }

  async submit(req: NormalizedRequest, model: string): Promise<SubmitResult> {
    const spec = doubaoModelSpecs.get(model);
    if (!spec) return unsupportedModelSubmitResult(this.id);

    try {
      if (spec.profile.kind === 'seedance-video') {
        const data = await postJson(
          videoTasksUrl(),
          buildVideoRequestBody(req, model, spec.profile),
          this.authHeaders(),
        );
        const handle = videoHandle(data, model);
        return handle
          ? { kind: 'async', handle }
          : {
              kind: 'failed',
              error: createProviderError(500, 'Seedance returned an invalid task reference', false, {
                disposition: 'unknown',
              }),
            };
      }
      const data = await postJsonWithInlineImageResponse(
        apiUrl(),
        buildRequestBody(req, model, spec.profile),
        this.authHeaders(),
        { timeoutMs: resolveSyncImageGenerationTimeoutMs() },
      );
      const images = parseImages(data, resolveSize(req, spec.profile));
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

  async poll(handle: JobHandle): Promise<PollResult> {
    const spec = doubaoModelSpecs.get(handle.model);
    if (!spec || spec.profile.kind !== 'seedance-video') {
      return {
        status: 'failed',
        error: createProviderError(400, 'Doubao task model is invalid', false),
      };
    }
    try {
      const data = await getJson(
        videoTaskUrl(handle.externalId),
        this.authHeaders(),
        15_000,
      ) as Record<string, unknown>;
      const status = String(data.status ?? '').toLowerCase();
      if (status === 'queued') return { status: 'pending' };
      if (status === 'running') return { status: 'running' };
      if (status === 'cancelled') return { status: 'cancelled' };
      if (status === 'failed') {
        return {
          status: 'failed',
          error: createProviderError(422, 'Seedance task failed', false, {
            diagnostic: classifyProviderDiagnostic('doubao', {
              httpStatus: 422,
              providerCode: data.error,
              providerRequestId: readProviderRequestIdFromResponse(data),
              upstreamRejected: true,
            }),
          }),
        };
      }
      if (status !== 'succeeded') {
        return {
          status: 'failed',
          error: createProviderError(500, 'Seedance returned an unknown task status', true),
        };
      }
      const videos = parseVideo(data);
      return videos.length > 0
        ? { status: 'completed', images: [], videos }
        : {
            status: 'failed',
            error: createProviderError(500, 'No video in Seedance response', false, {
              diagnostic: classifyProviderDiagnostic('doubao', { noResult: true }),
            }),
          };
    } catch (err) {
      return { status: 'failed', error: this.mapError(err) };
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
