import type {
  ImageProvider,
  JobHandle,
  NormalizedRequest,
  PollResult,
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
import { qwenModelSpecs, type QwenImageProfile } from '../capabilities/qwen';
import {
  modelCapabilityMap,
  unsupportedModelError,
  unsupportedModelSubmitResult,
} from '../model-spec';
import {
  providerEndpointUrl,
  trustedProviderBaseUrl,
  trustedProviderExternalId,
} from '../endpoint-policy';
import { resolveCredential } from '../../user-config';
import { resolveSyncImageGenerationTimeoutMs } from '../timeout-policy';
import {
  classifyProviderDiagnostic,
  readProviderRequestIdFromResponse,
} from '../error-diagnostics';

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1';

function baseUrl(): URL {
  return trustedProviderBaseUrl(
    process.env.DASHSCOPE_BASE_URL ?? DEFAULT_BASE_URL,
  );
}

function generationUrl(profile: QwenImageProfile): string {
  return providerEndpointUrl(baseUrl(), profile.path);
}

function taskUrl(taskId: string): string {
  return providerEndpointUrl(baseUrl(), [
    'tasks',
    trustedProviderExternalId(taskId),
  ]);
}

function resolveSize(req: NormalizedRequest, profile: QwenImageProfile): string {
  if (req.width && req.height) return `${req.width}*${req.height}`;
  return profile.aspectRatioSizes[req.aspectRatio ?? ''] ?? profile.defaultSize;
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

function buildMultimodalRequestBody(
  req: NormalizedRequest,
  model: string,
  profile: QwenImageProfile,
): Record<string, unknown> {
  const parameters: Record<string, unknown> = {
    size: resolveSize(req, profile),
    n: req.count ?? 1,
    watermark: false,
  };
  if (req.seed !== undefined) parameters.seed = req.seed;
  if (profile.kind === 'multimodal-sync') {
    parameters.prompt_extend = true;
    if (req.negativePrompt) parameters.negative_prompt = req.negativePrompt;
  } else if (profile.kind === 'wan-multimodal-sync') {
    parameters.enable_sequential = false;
    parameters.thinking_mode = true;
  } else {
    parameters.enable_sequential = false;
    parameters.thinking_mode = false;
  }

  return {
    model,
    input: {
      messages: [
        {
          role: 'user',
          content: [{ text: req.prompt }],
        },
      ],
    },
    parameters,
  };
}

function buildRequestBody(
  req: NormalizedRequest,
  model: string,
  profile: QwenImageProfile,
): Record<string, unknown> {
  return buildMultimodalRequestBody(req, model, profile);
}

function readOutput(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const output = (payload as Record<string, unknown>).output;
  return output && typeof output === 'object' ? (output as Record<string, unknown>) : null;
}

function parseMultimodalResults(payload: unknown): ProviderImageRef[] {
  const output = readOutput(payload);
  const choices = output?.choices;
  if (!Array.isArray(choices)) return [];

  const images: ProviderImageRef[] = [];
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue;
    const message = (choice as Record<string, unknown>).message;
    if (!message || typeof message !== 'object') continue;
    const content = (message as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      const image = item as Record<string, unknown>;
      if (typeof image.image !== 'string' || image.image.length === 0) continue;
      images.push({
        source: 'remote',
        url: image.image,
        width: typeof image.width === 'number' ? image.width : null,
        height: typeof image.height === 'number' ? image.height : null,
        contentType: contentTypeFromUrl(image.image),
        index: images.length,
      });
    }
  }
  return images;
}

function parseResults(payload: unknown): ProviderImageRef[] {
  return parseMultimodalResults(payload);
}

function qwenErrorCode(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }
  const root = payload as Record<string, unknown>;
  if (root.code !== undefined) return root.code;
  return readOutput(payload)?.code;
}

function asyncHandle(payload: unknown, model: string): JobHandle | null {
  const output = readOutput(payload);
  const taskId = output && typeof output.task_id === 'string' ? output.task_id : '';
  if (!taskId) return null;
  try {
    const statusUrl = taskUrl(taskId);
    return {
      providerId: 'qwen',
      model,
      externalId: taskId,
      statusUrl,
      responseUrl: statusUrl,
      cancelUrl: null,
      submittedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export class QwenProvider implements ImageProvider {
  id = 'qwen' as const;
  displayName = 'Qwen';
  capabilities = modelCapabilityMap(qwenModelSpecs);

  private authHeaders(): Record<string, string> {
    const key = resolveCredential('DASHSCOPE_API_KEY');
    return key ? { Authorization: `Bearer ${key}` } : {};
  }

  async submit(req: NormalizedRequest, model: string): Promise<SubmitResult> {
    const spec = qwenModelSpecs.get(model);
    if (!spec) return unsupportedModelSubmitResult(this.id);

    try {
      const body = buildRequestBody(req, model, spec.profile);
      if (spec.profile.kind !== 'multimodal-async') {
        const data = await postJson(
          generationUrl(spec.profile),
          body,
          this.authHeaders(),
          { timeoutMs: resolveSyncImageGenerationTimeoutMs() },
        );
        const images = parseResults(data);
        if (images.length === 0) {
          return {
            kind: 'failed',
            error: createProviderError(500, 'No images in Qwen response', false, {
              diagnostic: classifyProviderDiagnostic('qwen', { noResult: true }),
            }),
          };
        }
        return { kind: 'sync', images };
      }

      const data = await postJson(generationUrl(spec.profile), body, {
        ...this.authHeaders(),
        'X-DashScope-Async': 'enable',
      });
      const handle = asyncHandle(data, model);
      if (!handle) {
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
      return { kind: 'async', handle };
    } catch (err) {
      return { kind: 'failed', error: this.mapError(err) };
    }
  }

  async poll(handle: JobHandle): Promise<PollResult> {
    const spec = qwenModelSpecs.get(handle.model);
    if (!spec || spec.profile.kind !== 'multimodal-async') {
      return { status: 'failed', error: unsupportedModelError(this.id) };
    }

    try {
      // Persisted URL fields are compatibility data only. Reconstruct every
      // authenticated Qwen poll endpoint from the configured base + task ID.
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

      const code = typeof output?.code === 'string'
        ? output.code
        : typeof (data as Record<string, unknown>)?.code === 'string'
          ? String((data as Record<string, unknown>).code)
          : 'Qwen task failed';
      const message = typeof output?.message === 'string'
        ? output.message
        : typeof (data as Record<string, unknown>)?.message === 'string'
          ? String((data as Record<string, unknown>).message)
          : code;
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
