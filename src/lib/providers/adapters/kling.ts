import type {
  ImageProvider,
  JobHandle,
  NormalizedRequest,
  PollResult,
  ProviderImageRef,
  SubmitResult,
} from '../types';
import {
  createProviderError,
  createProviderErrorFromHttpError,
  getJson,
  postJson,
  ProviderHttpError,
} from '../http-client';
import { klingModelSpecs, type KlingImageProfile } from '../capabilities/kling';
import {
  modelCapabilityMap,
  unsupportedModelSubmitResult,
} from '../model-spec';
import {
  providerEndpointUrl,
  trustedProviderBaseUrl,
  trustedProviderExternalId,
} from '../endpoint-policy';
import { resolveCredential } from '../../user-config';
import {
  classifyProviderDiagnostic,
  readProviderRequestIdFromResponse,
} from '../error-diagnostics';

const DEFAULT_BASE_URL = 'https://api-singapore.klingai.com';
const RESERVED_KEYS = new Set([
  'model_name',
  'prompt',
  'negative_prompt',
  'image',
  'image_reference',
  'image_fidelity',
  'human_fidelity',
  'resolution',
  'n',
  'aspect_ratio',
  'watermark_info',
  'callback_url',
  'external_task_id',
]);

function baseUrl(): URL {
  return trustedProviderBaseUrl(process.env.KLING_BASE_URL ?? DEFAULT_BASE_URL);
}

function generationsUrl(taskId?: string): string {
  return providerEndpointUrl(baseUrl(), [
    'v1',
    'images',
    'generations',
    ...(taskId === undefined ? [] : [trustedProviderExternalId(taskId)]),
  ]);
}

function authHeaders(): Record<string, string> {
  const key = resolveCredential('KLING_API_KEY');
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function normalizeReferenceImage(value: string): string {
  return value.replace(/^data:[^;]+;base64,/i, '');
}

function buildRequestBody(
  req: NormalizedRequest,
  model: string,
  profile: KlingImageProfile,
): Record<string, unknown> {
  if (req.referenceImages && req.referenceImages.length > 1) {
    throw new Error('Kling standard image endpoint accepts at most one reference image');
  }
  const body: Record<string, unknown> = {
    model_name: model,
    prompt: req.prompt,
    resolution:
      req.providerOptions?.resolution === '2k' ? '2k' : profile.defaultResolution,
    n: req.count ?? 1,
    watermark_info: { enabled: false },
  };
  if (req.aspectRatio) body.aspect_ratio = req.aspectRatio;
  if (req.negativePrompt) body.negative_prompt = req.negativePrompt;
  if (req.referenceImages?.[0]) {
    body.image = normalizeReferenceImage(req.referenceImages[0]);
    body.image_reference = 'subject';
  }
  if (typeof req.providerOptions?.image_fidelity === 'number') {
    body.image_fidelity = req.providerOptions.image_fidelity;
  }
  if (typeof req.providerOptions?.human_fidelity === 'number') {
    body.human_fidelity = req.providerOptions.human_fidelity;
  }
  if (req.providerOptions?.watermark_info && typeof req.providerOptions.watermark_info === 'object') {
    body.watermark_info = req.providerOptions.watermark_info;
  }
  for (const [key, value] of Object.entries(req.providerOptions ?? {})) {
    if (!RESERVED_KEYS.has(key)) body[key] = value;
  }
  return body;
}

function parseStatus(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function readEnvelopeError(payload: unknown): { code: number; message: string } | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const rawCode = root.code;
  const code = typeof rawCode === 'number'
    ? rawCode
    : typeof rawCode === 'string' && /^\d+$/.test(rawCode)
      ? Number(rawCode)
      : 0;
  if (code === 0) return null;
  return {
    code,
    message: typeof root.message === 'string' ? root.message : 'Kling request failed',
  };
}

function klingHttpStatus(code: number): number {
  if (code >= 1000 && code <= 1004) return 401;
  if (code === 1103 || code === 1304) return 403;
  if (code === 1100 || code === 1101 || code === 1102 || code === 1302 || code === 1303) {
    return 429;
  }
  if (code === 1202 || code === 1203) return 404;
  if (code === 1200 || code === 1201 || code === 1300 || code === 1301) return 400;
  if (code === 5001) return 503;
  if (code === 5002) return 504;
  return 500;
}

function klingDiagnostic(payload: unknown, code: number, httpStatus: number) {
  return classifyProviderDiagnostic('kling', {
    httpStatus,
    providerCode: code,
    providerRequestId: readProviderRequestIdFromResponse(payload),
  });
}

function parseImages(payload: unknown): ProviderImageRef[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;
  const data = root.data;
  if (!data || typeof data !== 'object') return [];
  const taskResult = (data as Record<string, unknown>).task_result;
  if (!taskResult || typeof taskResult !== 'object') return [];
  const rawImages = (taskResult as Record<string, unknown>).images;
  if (!Array.isArray(rawImages)) return [];
  return rawImages.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const image = item as Record<string, unknown>;
    const url = typeof image.url === 'string' ? image.url : '';
    if (!url) return [];
    return [{
      source: 'remote' as const,
      url,
      width: null,
      height: null,
      contentType: 'image/png',
      index,
    }];
  });
}

export class KlingProvider implements ImageProvider {
  id = 'kling' as const;
  displayName = 'Kling AI';
  capabilities = modelCapabilityMap(klingModelSpecs);

  async submit(req: NormalizedRequest, model: string): Promise<SubmitResult> {
    const spec = klingModelSpecs.get(model);
    if (!spec) return unsupportedModelSubmitResult(this.id);

    try {
      const data = await postJson(
        generationsUrl(),
        buildRequestBody(req, model, spec.profile),
        authHeaders(),
      );
      const envelopeError = readEnvelopeError(data);
      if (envelopeError) {
        return {
          kind: 'failed',
          error: createProviderError(
            klingHttpStatus(envelopeError.code),
            envelopeError.message,
            false,
            {
              diagnostic: klingDiagnostic(
                data,
                envelopeError.code,
                klingHttpStatus(envelopeError.code),
              ),
            },
          ),
        };
      }
      const output = data && typeof data === 'object'
        ? (data as Record<string, unknown>).data
        : null;
      const taskId = output && typeof output === 'object' && typeof (output as Record<string, unknown>).task_id === 'string'
        ? (output as Record<string, unknown>).task_id as string
        : '';
      if (!taskId) {
        return { kind: 'failed', error: createProviderError(500, 'No task_id in Kling response') };
      }
      let statusUrl: string;
      try {
        statusUrl = generationsUrl(taskId);
      } catch {
        return {
          kind: 'failed',
          error: createProviderError(
            500,
            'Kling returned an invalid task reference',
            false,
            { disposition: 'unknown' },
          ),
        };
      }
      const handle: JobHandle = {
        providerId: 'kling',
        model,
        externalId: taskId,
        statusUrl,
        responseUrl: statusUrl,
        cancelUrl: null,
        submittedAt: new Date().toISOString(),
      };
      return { kind: 'async', handle };
    } catch (err) {
      return { kind: 'failed', error: this.mapError(err) };
    }
  }

  async poll(handle: JobHandle): Promise<PollResult> {
    try {
      // A JobHandle may originate from an older DB row. Its URL is not a
      // trust boundary; only the configured Kling base and external ID are.
      const data = await getJson(generationsUrl(handle.externalId), authHeaders(), 15_000);
      const envelopeError = readEnvelopeError(data);
      if (envelopeError) {
        return {
          status: 'failed',
          error: createProviderError(
            klingHttpStatus(envelopeError.code),
            envelopeError.message,
            false,
            {
              diagnostic: klingDiagnostic(
                data,
                envelopeError.code,
                klingHttpStatus(envelopeError.code),
              ),
            },
          ),
        };
      }
      const output = data && typeof data === 'object'
        ? (data as Record<string, unknown>).data
        : null;
      const status = output && typeof output === 'object'
        ? parseStatus((output as Record<string, unknown>).task_status)
        : '';
      if (status === 'submitted') return { status: 'pending' };
      if (status === 'processing') return { status: 'running' };
      if (status === 'succeed' || status === 'success' || status === 'completed') {
        const images = parseImages(data);
        return images.length > 0
          ? { status: 'completed', images }
          : {
              status: 'failed',
              error: createProviderError(500, 'No images in Kling response', false, {
                diagnostic: classifyProviderDiagnostic('kling', { noResult: true }),
              }),
            };
      }
      if (status === 'failed' || status === 'canceled' || status === 'cancelled') {
        const message = output && typeof output === 'object' && typeof (output as Record<string, unknown>).task_status_msg === 'string'
          ? (output as Record<string, unknown>).task_status_msg as string
          : `Kling task ${status}`;
        return status === 'canceled' || status === 'cancelled'
          ? { status: 'cancelled' }
          : {
              status: 'failed',
              error: createProviderError(422, message, false, {
                diagnostic: classifyProviderDiagnostic('kling', {
                  httpStatus: 422,
                  providerRequestId: readProviderRequestIdFromResponse(data),
                  upstreamRejected: true,
                }),
              }),
            };
      }
      return { status: 'failed', error: createProviderError(500, `Unexpected Kling status: ${status || 'unknown'}`) };
    } catch (err) {
      return { status: 'failed', error: this.mapError(err) };
    }
  }

  private mapError(err: unknown): ReturnType<typeof createProviderError> {
    if (err instanceof ProviderHttpError) {
      const body = err.body as Record<string, unknown> | null;
      const message = body && typeof body.message === 'string' ? body.message : err.message;
      const envelopeError = readEnvelopeError(err.body);
      return createProviderErrorFromHttpError(err, message, {
        diagnostic: classifyProviderDiagnostic('kling', {
          httpStatus: err.status,
          providerCode: envelopeError?.code,
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
        diagnostic: classifyProviderDiagnostic('kling', { transportTimeout: true }),
      });
    }
    return createProviderError(0, err instanceof Error ? err.message : String(err), false, {
      diagnostic: classifyProviderDiagnostic('kling'),
    });
  }
}
