import type {
  ImageProvider,
  NormalizedRequest,
  ProviderCapabilities,
  ProviderImageRef,
  SubmitResult,
} from '../types';
import { postJson, ProviderHttpError, createProviderError } from '../http-client';
import { zenmuxCapabilities } from '../capabilities/zenmux';

function resolveSize(req: NormalizedRequest): string {
  if (req.width && req.height) {
    return `${req.width}x${req.height}`;
  }

  const aspectRatioMap: Record<string, string> = {
    '1:1': '1024x1024',
    '3:2': '1536x1024',
    '2:3': '1024x1536',
  };

  if (req.aspectRatio && aspectRatioMap[req.aspectRatio]) {
    return aspectRatioMap[req.aspectRatio];
  }

  return '1024x1024';
}

function buildRequestBody(req: NormalizedRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: req.prompt,
    model: 'openai/gpt-image-2',
  };

  body.n = req.count ?? 1;
  body.size = resolveSize(req);

  for (const [key, value] of Object.entries(req.providerOptions ?? {})) {
    if (key !== 'size') {
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
  capabilities = new Map<string, ProviderCapabilities>(
    zenmuxCapabilities.map((c) => [c.model, c]),
  );

  private get apiKey(): string | undefined {
    return process.env.ZENMUX_API_KEY;
  }

  private authHeaders(): Record<string, string> {
    const key = this.apiKey;
    return key ? { Authorization: `Bearer ${key}` } : {};
  }

  async submit(req: NormalizedRequest, model: string): Promise<SubmitResult> {
    const url = 'https://zenmux.ai/api/v1/images/generations';
    try {
      const body = buildRequestBody(req);
      body.model = model;
      const data = await postJson(url, body, this.authHeaders());
      const images = parseImages(data);
      if (images.length === 0) {
        return {
          kind: 'failed',
          error: createProviderError(500, 'No images in zenmux response', false),
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
      const message =
        body && 'error' in body && body.error && typeof body.error === 'object'
          ? String((body.error as Record<string, unknown>).message ?? err.message)
          : err.message;
      return createProviderError(err.status, message, err.status === 429);
    }
    if (err instanceof Error && err.name === 'TimeoutError') {
      return createProviderError(0, err.message, true);
    }
    return createProviderError(0, err instanceof Error ? err.message : String(err), false);
  }
}
