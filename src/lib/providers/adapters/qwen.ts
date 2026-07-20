import type {
  ImageProvider,
  JobHandle,
  NormalizedRequest,
  PollResult,
  ProviderCapabilities,
  ProviderImageRef,
  SubmitResult,
} from '../types';
import {
  getJson,
  postJson,
  ProviderHttpError,
  createProviderError,
  createProviderErrorFromHttpError,
} from '../http-client';
import { qwenCapabilities } from '../capabilities/qwen';
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

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1';
const RESERVED_PARAMETER_KEYS = new Set([
  'negative_prompt',
  'size',
  'n',
  'prompt_extend',
  'watermark',
  'seed',
]);

function baseUrl(): URL {
  return trustedProviderBaseUrl(
    process.env.DASHSCOPE_BASE_URL ?? DEFAULT_BASE_URL,
  );
}

function synthesisUrl(): string {
  return providerEndpointUrl(baseUrl(), [
    'services',
    'aigc',
    'text2image',
    'image-synthesis',
  ]);
}

function taskUrl(taskId: string): string {
  return providerEndpointUrl(baseUrl(), [
    'tasks',
    trustedProviderExternalId(taskId),
  ]);
}

function resolveSize(req: NormalizedRequest): string {
  if (req.width && req.height) return `${req.width}*${req.height}`;

  const aspectRatioMap: Record<string, string> = {
    '16:9': '1664*928',
    '4:3': '1472*1104',
    '1:1': '1328*1328',
    '3:4': '1104*1472',
    '9:16': '928*1664',
  };
  return aspectRatioMap[req.aspectRatio ?? ''] ?? '1664*928';
}

function parseDimensions(size: string): { width: number | null; height: number | null } {
  const match = /^(\d+)[*x](\d+)$/.exec(size);
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
    // Keep the documented PNG default for opaque provider URLs.
  }
  return 'image/png';
}

function buildRequestBody(req: NormalizedRequest, model: string): Record<string, unknown> {
  const parameters: Record<string, unknown> = {
    size: resolveSize(req),
    n: 1,
    prompt_extend: true,
    watermark: false,
  };
  if (req.negativePrompt) parameters.negative_prompt = req.negativePrompt;
  if (req.seed !== undefined) parameters.seed = req.seed;

  for (const [key, value] of Object.entries(req.providerOptions ?? {})) {
    if (!RESERVED_PARAMETER_KEYS.has(key)) parameters[key] = value;
  }

  return {
    model,
    input: { prompt: req.prompt },
    parameters,
  };
}

function parseResults(payload: unknown): ProviderImageRef[] {
  if (!payload || typeof payload !== 'object') return [];
  const output = (payload as Record<string, unknown>).output;
  if (!output || typeof output !== 'object') return [];
  const rawResults = (output as Record<string, unknown>).results;
  if (!Array.isArray(rawResults)) return [];

  return rawResults.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const result = item as Record<string, unknown>;
    if (typeof result.url !== 'string' || result.url.length === 0) return [];
    const dimensions =
      typeof result.size === 'string'
        ? parseDimensions(result.size)
        : { width: null, height: null };
    return [{
      url: result.url,
      width: dimensions.width,
      height: dimensions.height,
      contentType: contentTypeFromUrl(result.url),
      index,
      revisedPrompt:
        typeof result.actual_prompt === 'string' ? result.actual_prompt : undefined,
    }];
  });
}

function readOutput(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const output = (payload as Record<string, unknown>).output;
  return output && typeof output === 'object' ? (output as Record<string, unknown>) : null;
}

function qwenErrorCode(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }
  const root = payload as Record<string, unknown>;
  if (root.code !== undefined) return root.code;
  return readOutput(payload)?.code;
}

export class QwenProvider implements ImageProvider {
  id = 'qwen' as const;
  displayName = 'Qwen';
  capabilities = new Map<string, ProviderCapabilities>(
    qwenCapabilities.map((capability) => [capability.model, capability]),
  );

  private authHeaders(): Record<string, string> {
    const key = resolveCredential('DASHSCOPE_API_KEY');
    return key ? { Authorization: `Bearer ${key}` } : {};
  }

  async submit(req: NormalizedRequest, model: string): Promise<SubmitResult> {
    try {
      const data = await postJson(synthesisUrl(), buildRequestBody(req, model), {
        ...this.authHeaders(),
        'X-DashScope-Async': 'enable',
      });
      const output = readOutput(data);
      const taskId = output && typeof output.task_id === 'string' ? output.task_id : '';
      if (!taskId) {
        return {
          kind: 'failed',
          error: createProviderError(500, 'No task_id in Qwen response', false),
        };
      }
      let statusUrl: string;
      try {
        statusUrl = taskUrl(taskId);
      } catch {
        return {
          kind: 'failed',
          error: createProviderError(
            500,
            'Qwen returned an invalid task reference',
            false,
            { disposition: 'unknown' },
          ),
        };
      }
      const handle: JobHandle = {
        providerId: 'qwen',
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
      // Persisted URL fields are legacy compatibility data only. Reconstruct
      // every authenticated Qwen poll endpoint from the configured base + ID.
      const data = await getJson(taskUrl(handle.externalId), this.authHeaders());
      const output = readOutput(data);
      const status = typeof output?.task_status === 'string'
        ? output.task_status.toUpperCase()
        : 'UNKNOWN';

      if (status === 'PENDING') return { status: 'pending' };
      if (status === 'RUNNING') return { status: 'running' };
      if (status === 'CANCELED' || status === 'CANCELLED') return { status: 'cancelled' };
      if (status === 'SUCCEEDED') {
        const images = parseResults(data);
        return images.length > 0
          ? { status: 'completed', images }
          : {
              status: 'failed',
              error: createProviderError(500, 'No images in Qwen response', false, {
                diagnostic: classifyProviderDiagnostic('qwen', { noResult: true }),
              }),
            };
      }

      const code = typeof output?.code === 'string' ? output.code : 'Qwen task failed';
      const message = typeof output?.message === 'string' ? output.message : code;
      return {
        status: 'failed',
        error: createProviderError(422, `${code}: ${message}`, false, {
          diagnostic: classifyProviderDiagnostic('qwen', {
            httpStatus: 422,
            providerCode: code,
            providerRequestId: readProviderRequestIdFromResponse(data),
            upstreamRejected: true,
          }),
        }),
      };
    } catch (err) {
      return { status: 'failed', error: this.mapError(err) };
    }
  }

  private mapError(err: unknown): ReturnType<typeof createProviderError> {
    if (err instanceof ProviderHttpError) {
      const body = err.body as Record<string, unknown> | null;
      const message =
        body && typeof body.message === 'string'
          ? body.message
          : body && typeof body.error === 'string'
            ? body.error
            : err.message;
      return createProviderErrorFromHttpError(err, message, {
        diagnostic: classifyProviderDiagnostic('qwen', {
          httpStatus: err.status,
          providerCode: qwenErrorCode(err.body),
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
        diagnostic: classifyProviderDiagnostic('qwen', { transportTimeout: true }),
      });
    }
    return createProviderError(0, err instanceof Error ? err.message : String(err), false, {
      diagnostic: classifyProviderDiagnostic('qwen'),
    });
  }
}
