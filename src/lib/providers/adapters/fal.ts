import type {
  ImageProvider,
  NormalizedRequest,
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
import { falModelSpecs, type FalImageProfile } from '../capabilities/fal';
import {
  modelCapabilityMap,
  unsupportedModelSubmitResult,
} from '../model-spec';
import {
  providerEndpointUrl,
  trustedProviderBaseUrl,
  trustedProviderExternalId,
  trustedSameOriginProviderUrl,
} from '../endpoint-policy';
import { resolveCredential } from '../../user-config';
import {
  classifyProviderDiagnostic,
  readProviderRequestIdFromResponse,
} from '../error-diagnostics';

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

type FluxImageProfile = Extract<FalImageProfile, { kind: 'flux-image-size' }>;
type BananaImageProfile = Extract<FalImageProfile, { kind: 'banana-aspect-ratio' }>;

function resolveFluxSize(req: NormalizedRequest, profile: FluxImageProfile): string {
  if (req.aspectRatio && profile.aspectRatioSizes[req.aspectRatio]) {
    return profile.aspectRatioSizes[req.aspectRatio];
  }

  return profile.defaultSize;
}

function buildRequestBody(
  req: NormalizedRequest,
  profile: FalImageProfile,
): Record<string, unknown> {
  if (profile.kind === 'banana-aspect-ratio') {
    return buildBananaRequestBody(req, profile);
  }

  const body: Record<string, unknown> = {
    prompt: req.prompt,
  };

  if (profile.supportsCount && req.count && req.count > 1) {
    body.num_images = req.count;
  }
  if (req.seed !== undefined) {
    body.seed = req.seed;
  }

  body.image_size = resolveFluxSize(req, profile);

  if (profile.supportsNegativePrompt && req.negativePrompt) {
    body.negative_prompt = req.negativePrompt;
  }

  for (const [key, value] of Object.entries(req.providerOptions ?? {})) {
    if (profile.allowedProviderOptions.includes(key)) {
      body[key] = value;
    }
  }

  return body;
}

function buildBananaRequestBody(
  req: NormalizedRequest,
  profile: BananaImageProfile,
): Record<string, unknown> {
  const requestedResolution = req.providerOptions?.resolution;
  const outputFormat = req.providerOptions?.output_format;
  const safetyTolerance = req.providerOptions?.safety_tolerance;
  const body: Record<string, unknown> = {
    prompt: req.prompt,
    num_images: req.count ?? 1,
    aspect_ratio: req.aspectRatio ?? profile.defaultAspectRatio,
    output_format:
      outputFormat === 'jpeg' || outputFormat === 'webp' ? outputFormat : 'png',
    limit_generations: true,
  };
  if (profile.defaultResolution) {
    body.resolution =
      typeof requestedResolution === 'string' &&
      profile.supportedResolutions.includes(requestedResolution)
        ? requestedResolution
        : profile.defaultResolution;
  }
  if (req.seed !== undefined) body.seed = req.seed;
  if (
    typeof safetyTolerance === 'string' &&
    profile.safetyToleranceValues.includes(safetyTolerance)
  ) {
    body.safety_tolerance = safetyTolerance;
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
      source: 'remote' as const,
      url: String(img.url ?? ''),
      width,
      height,
      contentType,
      index: idx,
    };
  });
}

function falErrorType(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }
  const root = payload as Record<string, unknown>;
  if (typeof root.error_type === 'string') return root.error_type;
  const detail = root.detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    return (detail as Record<string, unknown>).type;
  }
  if (Array.isArray(detail) && detail[0] && typeof detail[0] === 'object') {
    return (detail[0] as Record<string, unknown>).type;
  }
  return undefined;
}

export class FalProvider implements ImageProvider {
  id = 'fal' as const;
  displayName = 'fal.ai';
  capabilities = modelCapabilityMap(falModelSpecs);

  private get apiKey(): string | undefined {
    return resolveCredential('FAL_KEY');
  }

  private authHeaders(): Record<string, string> {
    const key = this.apiKey;
    return key ? { Authorization: `Key ${key}` } : {};
  }

  async submit(req: NormalizedRequest, model: string): Promise<SubmitResult> {
    const spec = falModelSpecs.get(model);
    if (!spec) return unsupportedModelSubmitResult(this.id);

    try {
      const body = buildRequestBody(req, spec.profile);
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
      if (status === 'FAILED') {
        return {
          status: 'failed',
          error: createProviderError(422, 'Fal task failed', false, {
            diagnostic: classifyProviderDiagnostic('fal', {
              httpStatus: 422,
              providerCode: falErrorType(statusData),
              providerRequestId: readProviderRequestIdFromResponse(statusData),
              upstreamRejected: true,
            }),
          }),
        };
      }
      if (status !== 'COMPLETED') {
        return {
          status: 'failed',
          error: createProviderError(
            500,
            `Unexpected fal status: ${status}`,
            false,
            {
              diagnostic: classifyProviderDiagnostic('fal', {
                httpStatus: 500,
              }),
            },
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
          error: createProviderError(500, 'No images in fal response', false, {
            diagnostic: classifyProviderDiagnostic('fal', { noResult: true }),
          }),
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
      const retryableHeader = err.getHeader('x-fal-retryable')?.toLowerCase();
      return createProviderErrorFromHttpError(err, message, {
        ...(retryableHeader === 'true' || retryableHeader === 'false'
          ? { retryable: retryableHeader === 'true' }
          : {}),
        diagnostic: classifyProviderDiagnostic('fal', {
          httpStatus: err.status,
          providerCode: falErrorType(err.body) ?? err.getHeader('x-fal-error-type'),
          providerRequestId: readProviderRequestIdFromResponse(err.body, [
            err.getHeader('x-fal-request-id'),
            err.getHeader('x-request-id'),
          ]),
          transportTimeout: err.status === 0 && err.retryable,
        }),
      });
    }
    if (err instanceof Error && err.name === 'TimeoutError') {
      return createProviderError(0, err.message, true, {
        disposition: 'unknown',
        diagnostic: classifyProviderDiagnostic('fal', { transportTimeout: true }),
      });
    }
    return createProviderError(0, err instanceof Error ? err.message : String(err), false, {
      diagnostic: classifyProviderDiagnostic('fal'),
    });
  }
}
