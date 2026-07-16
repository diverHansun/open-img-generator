import type {
  GenerationView,
  HealthView,
  ProviderInfo,
  SubmitGenerationRequest,
  SubmitGenerationResponse,
} from './types';

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export type FetchLike = typeof fetch;

async function requestJson<T>(
  fetcher: FetchLike,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetcher(input, init);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
    throw new ApiClientError(
      typeof payload?.error === 'string' ? payload.error : response.statusText,
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

export function createApiClient(fetcher: FetchLike = fetch) {
  return {
    getHealth: () => requestJson<HealthView>(fetcher, '/api/health'),
    listProviders: () => requestJson<ProviderInfo[]>(fetcher, '/api/providers'),
    submitGeneration: (payload: SubmitGenerationRequest) =>
      requestJson<SubmitGenerationResponse>(fetcher, '/api/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    getGeneration: (selfLink: string) =>
      requestJson<GenerationView>(fetcher, selfLink),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
