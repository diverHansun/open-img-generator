import type {
  GenerationView,
  GalleryItem,
  HealthView,
  ModelPreference,
  Page,
  Project,
  ProviderInfo,
  Session,
  GenerationSummary,
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

function jsonInit(method: string, payload: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function listUrl(
  pathname: string,
  query: Record<string, string | number | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `${pathname}?${encoded}` : pathname;
}

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
      requestJson<SubmitGenerationResponse>(
        fetcher,
        '/api/generations',
        jsonInit('POST', payload),
      ),
    getGeneration: (selfLink: string) =>
      requestJson<GenerationView>(fetcher, selfLink),
    listGenerations: (query: {
      limit?: number;
      cursor?: string;
      sessionId?: string;
      projectId?: string;
    } = {}) =>
      requestJson<Page<GenerationSummary>>(
        fetcher,
        listUrl('/api/generations', query),
      ),
    listProjects: () => requestJson<Project[]>(fetcher, '/api/projects'),
    createProject: (title: string) =>
      requestJson<Project>(fetcher, '/api/projects', jsonInit('POST', { title })),
    getProject: (id: string) =>
      requestJson<Project>(fetcher, `/api/projects/${encodeURIComponent(id)}`),
    updateProject: (id: string, title: string) =>
      requestJson<Project>(
        fetcher,
        `/api/projects/${encodeURIComponent(id)}`,
        jsonInit('PATCH', { title }),
      ),
    deleteProject: (id: string) =>
      fetcher(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(
        async (response) => {
          if (!response.ok) {
            const payload = (await response.json().catch(() => null)) as {
              error?: unknown;
            } | null;
            throw new ApiClientError(
              typeof payload?.error === 'string'
                ? payload.error
                : response.statusText,
              response.status,
            );
          }
        },
      ),
    listSessions: (projectId: string) =>
      requestJson<Session[]>(
        fetcher,
        `/api/projects/${encodeURIComponent(projectId)}/sessions`,
      ),
    createSession: (projectId: string, title?: string) =>
      requestJson<Session>(
        fetcher,
        `/api/projects/${encodeURIComponent(projectId)}/sessions`,
        jsonInit('POST', { title }),
      ),
    getSession: (id: string) =>
      requestJson<Session>(fetcher, `/api/sessions/${encodeURIComponent(id)}`),
    updateSession: (id: string, title: string) =>
      requestJson<Session>(
        fetcher,
        `/api/sessions/${encodeURIComponent(id)}`,
        jsonInit('PATCH', { title }),
      ),
    moveSession: (id: string, toProjectId: string) =>
      requestJson<Session>(
        fetcher,
        `/api/sessions/${encodeURIComponent(id)}/move`,
        jsonInit('POST', { toProjectId }),
      ),
    listFavorites: (query: { limit?: number; cursor?: string } = {}) =>
      requestJson<Page<GalleryItem>>(
        fetcher,
        listUrl('/api/favorites', query),
      ),
    addFavorite: (imageId: string) =>
      requestJson<GalleryItem>(
        fetcher,
        '/api/favorites',
        jsonInit('POST', { imageId }),
      ),
    removeFavorite: (imageId: string) =>
      fetcher(`/api/favorites/${encodeURIComponent(imageId)}`, {
        method: 'DELETE',
      }).then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            error?: unknown;
          } | null;
          throw new ApiClientError(
            typeof payload?.error === 'string' ? payload.error : response.statusText,
            response.status,
          );
        }
      }),
    listModelPreferences: () =>
      requestJson<{ items: ModelPreference[] }>(
        fetcher,
        '/api/model-preferences',
      ),
    upsertModelPreference: (input: {
      provider: string;
      model: string;
      enabled: boolean;
    }) =>
      requestJson<ModelPreference>(
        fetcher,
        '/api/model-preferences',
        jsonInit('PUT', input),
      ),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
