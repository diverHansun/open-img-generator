import type {
  ImageProvider,
  NormalizedRequest,
  ProviderCapabilities,
  ProviderImageRef,
  SubmitResult,
} from '../types';
import { postJson, ProviderHttpError, createProviderError } from '../http-client';
import { zenmuxCapabilities } from '../capabilities/zenmux';

function buildRequestBody(req: NormalizedRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: req.prompt,
    model: 'openai/gpt-image-2',
  };

  body.n = req.count ?? 1;

  if (req.width && req.height) {
    body.size = `${req.width}x${req.height}`;
  } else if (req.aspectRatio) {
    body.size = req.aspectRatio;
  } else {
    body.size = '1024x1024';
  }

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

  return rawData.map((item, idx) => {
    const img = item as Record<string, unknown>;
    return {
      url: String(img.url ?? ''),
      width: null,
      height: null,
      contentType: 'image/png',
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
