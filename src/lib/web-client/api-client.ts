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
    readonly requestId?: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

const MAX_RETRY_AFTER_MS = 5 * 60 * 1_000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

export type FetchLike = typeof fetch;
export type ApiRequestOptions = {
  signal?: AbortSignal;
};

const SUBMIT_DEADLINE_MS = 30_000;
const DETAIL_DEADLINE_MS = 15_000;

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
  deadlineMs?: number,
): Promise<T> {
  const deadline = deadlineMs ? requestWithDeadline(init, deadlineMs) : null;
  try {
    const response = await fetcher(input, deadline?.init ?? init);
    if (!response.ok) {
      throw await toApiClientError(response);
    }
    return response.json() as Promise<T>;
  } finally {
    deadline?.cleanup();
  }
}

function requestWithDeadline(
  init: RequestInit | undefined,
  timeoutMs: number,
): { init: RequestInit; cleanup: () => void } {
  const controller = new AbortController();
  const callerSignal = init?.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    init: { ...init, signal: controller.signal },
    cleanup: () => {
      clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    },
  };
}

function requestInitWithSignal(options?: ApiRequestOptions): RequestInit | undefined {
  return options?.signal ? { signal: options.signal } : undefined;
}

function validRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value)
    ? value
    : undefined;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  let milliseconds: number;
  if (/^\d+$/.test(value)) {
    milliseconds = Number(value) * 1_000;
  } else {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return undefined;
    milliseconds = Math.max(0, timestamp - Date.now());
  }
  if (!Number.isFinite(milliseconds)) return undefined;
  return Math.min(milliseconds, MAX_RETRY_AFTER_MS);
}

async function toApiClientError(response: Response): Promise<ApiClientError> {
  const payload = (await response.json().catch(() => null)) as
    | { error?: unknown }
    | null;
  const headerRequestId = validRequestId(response.headers.get('X-Request-Id'));
  const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
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
        validRequestId(structured.error.requestId) ?? headerRequestId,
        retryAfterMs,
      );
    }
  }
  return new ApiClientError(
    typeof payload?.error === 'string' ? payload.error : response.statusText,
    response.status,
    undefined,
    undefined,
    headerRequestId,
    retryAfterMs,
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
    getAuthSession: (options?: ApiRequestOptions) =>
      requestJson<{ authenticated: boolean }>(
        fetcher,
        '/api/auth/session',
        requestInitWithSignal(options),
      ),
    login: (token: string) =>
      requestJson<{ authenticated: boolean }>(
        fetcher,
        '/api/auth/session',
        jsonInit('POST', { token }),
      ),
    getHealth: (options?: ApiRequestOptions) =>
      requestJson<HealthView>(
        fetcher,
        '/api/health',
        requestInitWithSignal(options),
      ),
    listProviders: (options?: ApiRequestOptions) =>
      requestJson<ProviderInfo[]>(
        fetcher,
        '/api/providers',
        requestInitWithSignal(options),
      ),
    submitGeneration: (payload: SubmitGenerationRequest) =>
      requestJson<SubmitGenerationResponse>(
        fetcher,
        '/api/generations',
        {
          ...jsonInit('POST', payload),
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': payload.clientRequestId,
          },
        },
        SUBMIT_DEADLINE_MS,
      ),
    getGeneration: (selfLink: string, options?: ApiRequestOptions) =>
      requestJson<GenerationView>(
        fetcher,
        selfLink,
        requestInitWithSignal(options),
        DETAIL_DEADLINE_MS,
      ),
    getGenerationById: (id: string, options?: ApiRequestOptions) =>
      requestJson<GenerationView>(
        fetcher,
        `/api/generations/${encodeURIComponent(id)}`,
        requestInitWithSignal(options),
        DETAIL_DEADLINE_MS,
      ),
    cancelGeneration: (id: string) =>
      requestJson<GenerationView>(
        fetcher,
        `/api/generations/${encodeURIComponent(id)}/cancel`,
        jsonInit('POST', {}),
        DETAIL_DEADLINE_MS,
      ),
    listGenerations: (
      query: {
        limit?: number;
        cursor?: string;
        sessionId?: string;
        projectId?: string;
      } = {},
      options?: ApiRequestOptions,
    ) =>
      requestJson<Page<GenerationSummary>>(
        fetcher,
        listUrl('/api/generations', query),
        requestInitWithSignal(options),
      ),
    listProjects: (options?: ApiRequestOptions) =>
      requestJson<Project[]>(
        fetcher,
        '/api/projects',
        requestInitWithSignal(options),
      ),
    listProjectSummaries: (options?: ApiRequestOptions) =>
      requestJson<ProjectSummary[]>(
        fetcher,
        '/api/project-summaries',
        requestInitWithSignal(options),
      ),
    createProject: (title: string) =>
      requestJson<Project>(fetcher, '/api/projects', jsonInit('POST', { title })),
    getProject: (id: string, options?: ApiRequestOptions) =>
      requestJson<Project>(
        fetcher,
        `/api/projects/${encodeURIComponent(id)}`,
        requestInitWithSignal(options),
      ),
    updateProject: (id: string, title: string) =>
      requestJson<Project>(
        fetcher,
        `/api/projects/${encodeURIComponent(id)}`,
        jsonInit('PATCH', { title }),
      ),
    deleteProject: (id: string) =>
      requestEmpty(fetcher, `/api/projects/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    listSessions: (projectId: string, options?: ApiRequestOptions) =>
      requestJson<Session[]>(
        fetcher,
        `/api/projects/${encodeURIComponent(projectId)}/sessions`,
        requestInitWithSignal(options),
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
    getSession: (id: string, options?: ApiRequestOptions) =>
      requestJson<Session>(
        fetcher,
        `/api/sessions/${encodeURIComponent(id)}`,
        requestInitWithSignal(options),
      ),
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
    listModelPreferences: (options?: ApiRequestOptions) =>
      requestJson<{ items: ModelPreference[] }>(
        fetcher,
        '/api/model-preferences',
        requestInitWithSignal(options),
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
