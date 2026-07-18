import type {
  ApiErrorBody,
  GenerationView,
  GalleryItem,
  HealthView,
  HistoryPage,
  ModelPreference,
  Page,
  Project,
  ProjectSummary,
  ProviderConfiguration,
  ProviderId,
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
    readonly code = `HTTP_${status}`,
    readonly retryable = status === 429 || status >= 500,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export type FetchLike = typeof fetch;
export type ApiRequestOptions = {
  signal?: AbortSignal;
};

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
    throw await toApiClientError(response);
  }
  return response.json() as Promise<T>;
}

function requestInitWithSignal(options?: ApiRequestOptions): RequestInit | undefined {
  return options?.signal ? { signal: options.signal } : undefined;
}

async function toApiClientError(response: Response): Promise<ApiClientError> {
  const payload = (await response.json().catch(() => null)) as
    | { error?: unknown }
    | null;
  if (
    payload?.error &&
    typeof payload.error === 'object' &&
    !Array.isArray(payload.error)
  ) {
    const structured = payload as ApiErrorBody;
    if (
      typeof structured.error.code === 'string' &&
      typeof structured.error.message === 'string' &&
      typeof structured.error.retryable === 'boolean'
    ) {
      return new ApiClientError(
        structured.error.message,
        response.status,
        structured.error.code,
        structured.error.retryable,
      );
    }
  }
  return new ApiClientError(
    typeof payload?.error === 'string' ? payload.error : response.statusText,
    response.status,
  );
}

async function requestEmpty(
  fetcher: FetchLike,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<void> {
  const response = await fetcher(input, init);
  if (!response.ok) throw await toApiClientError(response);
}

export function createApiClient(fetcher: FetchLike = fetch) {
  return {
    getAuthSession: () => requestJson<{ authenticated: boolean }>(fetcher, '/api/auth/session'),
    login: (token: string) =>
      requestJson<{ authenticated: boolean }>(
        fetcher,
        '/api/auth/session',
        jsonInit('POST', { token }),
      ),
    getHealth: () => requestJson<HealthView>(fetcher, '/api/health'),
    listProviders: () => requestJson<ProviderInfo[]>(fetcher, '/api/providers'),
    submitGeneration: (payload: SubmitGenerationRequest) =>
      requestJson<SubmitGenerationResponse>(
        fetcher,
        '/api/generations',
        jsonInit('POST', payload),
      ),
    getGeneration: (selfLink: string, options?: ApiRequestOptions) =>
      requestJson<GenerationView>(fetcher, selfLink, requestInitWithSignal(options)),
    getGenerationById: (id: string, options?: ApiRequestOptions) =>
      requestJson<GenerationView>(
        fetcher,
        `/api/generations/${encodeURIComponent(id)}`,
        requestInitWithSignal(options),
      ),
    cancelGeneration: (id: string) =>
      requestJson<GenerationView>(
        fetcher,
        `/api/generations/${encodeURIComponent(id)}/cancel`,
        jsonInit('POST', {}),
      ),
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
    listProjectSummaries: (options?: ApiRequestOptions) =>
      requestJson<ProjectSummary[]>(
        fetcher,
        '/api/project-summaries',
        requestInitWithSignal(options),
      ),
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
    ensureInitialSession: (projectId: string) =>
      requestJson<Session>(
        fetcher,
        `/api/projects/${encodeURIComponent(projectId)}/sessions/initial`,
        jsonInit('POST', {}),
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
    getProjectHistory: (
      projectId: string,
      query: { page?: number; sessionLimit?: number; generationLimit?: number } = {},
      options?: ApiRequestOptions,
    ) =>
      requestJson<HistoryPage>(
        fetcher,
        listUrl(
          `/api/projects/${encodeURIComponent(projectId)}/history`,
          query,
        ),
        requestInitWithSignal(options),
      ),
    listFavorites: (
      query: {
        limit?: number;
        cursor?: string;
        projectId?: string;
        provider?: ProviderId;
        sort?: 'newest';
      } = {},
      options?: ApiRequestOptions,
    ) =>
      requestJson<Page<GalleryItem>>(
        fetcher,
        listUrl('/api/favorites', query),
        requestInitWithSignal(options),
      ),
    addFavorite: (imageId: string) =>
      requestJson<GalleryItem>(
        fetcher,
        '/api/favorites',
        jsonInit('POST', { imageId }),
      ),
    removeFavorite: (imageId: string) =>
      requestEmpty(fetcher, `/api/favorites/${encodeURIComponent(imageId)}`, {
        method: 'DELETE',
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
    listProviderConfigurations: (options?: ApiRequestOptions) =>
      requestJson<ProviderConfiguration[]>(
        fetcher,
        '/api/provider-configurations',
        requestInitWithSignal(options),
      ),
    saveProviderCredential: (providerId: ProviderId, value: string) =>
      requestJson<ProviderConfiguration>(
        fetcher,
        `/api/provider-configurations/${encodeURIComponent(providerId)}/credential`,
        jsonInit('PUT', { value }),
      ),
    removeProviderCredential: (providerId: ProviderId) =>
      requestJson<ProviderConfiguration>(
        fetcher,
        `/api/provider-configurations/${encodeURIComponent(providerId)}/credential`,
        { method: 'DELETE' },
      ),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
