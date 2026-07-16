'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  buildSubmitGenerationRequest,
  createApiClient,
  deriveGenerationControls,
  GenerationPollingController,
  type GenerationStatus,
  type GenerationTarget,
  type GenerationView,
  type HealthView,
  type JobView,
  type ProviderInfo,
  type SubmitGenerationResponse,
} from '@/lib/web-client';

const DEFAULT_PROMPT =
  'A cozy reading nook in a sunlit apartment, mid-century modern armchair, wooden bookshelf, potted plants, warm afternoon light, photorealistic.';

const RANDOM_PROMPTS = [
  DEFAULT_PROMPT,
  'A quiet brutalist library at blue hour, warm pools of light, rain on concrete, architectural photography, subtle film grain.',
  'Small ceramics studio beside the sea, linen curtains moving in the breeze, sun-faded colors, tactile editorial photography.',
  'A moss-covered observatory in a misty forest, diffused morning light, cinematic realism, intricate botanical detail.',
];

const ACTIVE_GENERATION_KEY = 'open-image-generator.active-generation';
const TERMINAL_STATUSES = new Set<GenerationStatus>(['completed', 'failed', 'cancelled']);

const NAV_ITEMS = [
  { id: 'generate', label: 'Generate', enabled: true },
  { id: 'history', label: 'History', enabled: false },
  { id: 'gallery', label: 'Gallery', enabled: false },
  { id: 'models', label: 'Models', enabled: true },
  { id: 'providers', label: 'Providers', enabled: true },
  { id: 'settings', label: 'Settings', enabled: false },
] as const;

type ProviderLoadState = 'loading' | 'ready' | 'error';
type HealthLoadState = 'loading' | 'ready' | 'error';

type PendingGeneration = SubmitGenerationResponse & {
  prompt: string;
  targets: GenerationTarget[];
  count: number;
  aspectRatio: string;
};

type DisplayJob = Pick<JobView, 'id' | 'provider' | 'model' | 'status' | 'error'> & {
  images: Array<{
    id: string;
    url: string;
    width: number | null;
    height: number | null;
  }>;
};

function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    generate: <><path d="M4 20h16M6 16 16 6l2 2L8 18H6v-2Z"/><path d="m14 5 2-2 3 3-2 2"/></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></>,
    gallery: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="8.5" r="1.5"/></>,
    models: <><path d="m12 3 8 4-8 4-8-4 8-4Z"/><path d="m4 12 8 4 8-4M4 17l8 4 8-4"/></>,
    providers: <><path d="M8 8a4 4 0 1 1 8 0v2H8V8Z"/><path d="M6 10h12v8a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v-8ZM9 14h.01M15 14h.01"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    dice: <><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1"/><circle cx="16" cy="8" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/></>,
    sparkles: <><path d="m12 3 1.3 3.7L17 8l-3.7 1.3L12 13l-1.3-3.7L7 8l3.7-1.3L12 3Z"/><path d="m18 14 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14ZM5 13l.7 2.3L8 16l-2.3.7L5 19l-.7-2.3L2 16l2.3-.7L5 13Z"/></>,
    refresh: <><path d="M20 6v5h-5"/><path d="M4 18v-5h5M18.5 9A7 7 0 0 0 6 6.5L4 11M5.5 15A7 7 0 0 0 18 17.5l2-4.5"/></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m3 17 5-5 4 4 3-3 6 6"/></>,
    close: <path d="M6 6l12 12M18 6 6 18"/>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></>,
  };

  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function modelKey(target: GenerationTarget) {
  return `${target.provider}:${target.model}`;
}

function statusLabel(status: GenerationStatus) {
  const labels: Record<GenerationStatus, string> = {
    pending: 'Queued',
    running: 'Generating',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };
  return labels[status];
}

function displayJobsFor(
  generation: GenerationView | null,
  pending: PendingGeneration | null,
): DisplayJob[] {
  if (generation) {
    return generation.jobs.map((job) => ({
      ...job,
      images: generation.images
        .filter((image) => image.jobId === job.id)
        .sort((a, b) => a.index - b.index)
        .map((image) => ({
          id: image.id,
          url: image.url,
          width: image.width,
          height: image.height,
        })),
    }));
  }

  return (pending?.targets ?? []).map((target, index) => ({
    id: `pending-${index}`,
    provider: target.provider,
    model: target.model,
    status: 'pending',
    images: [],
  }));
}

function ResultsGrid({
  jobs,
  count,
  aspectRatio,
  providerNames,
  modelNames,
  onPreview,
}: {
  jobs: DisplayJob[];
  count: number;
  aspectRatio: string;
  providerNames: Map<string, string>;
  modelNames: Map<string, string>;
  onPreview: (url: string) => void;
}) {
  const fallbackAspect = aspectRatio.replace(':', ' / ');

  return (
    <div className="provider-results">
      {jobs.map((job) => {
        const isWaiting = !TERMINAL_STATUSES.has(job.status) && job.images.length === 0;
        return (
          <section className="provider-result" key={job.id}>
            <div className="result-provider-meta">
              <span className="result-provider-name">{providerNames.get(job.provider) ?? job.provider}</span>
              <strong>{modelNames.get(`${job.provider}:${job.model}`) ?? job.model}</strong>
              <span className={`status-badge status-${job.status}`}>
                <span className="status-dot" />
                {statusLabel(job.status)}
              </span>
              <span className="result-count">
                <Icon name="image" /> {job.images.length || count} image{(job.images.length || count) === 1 ? '' : 's'}
              </span>
              {job.error ? <p className="job-error">{job.error.message}</p> : null}
            </div>

            <div className="image-strip">
              {job.images.map((image) => (
                <button
                  className="image-tile"
                  type="button"
                  key={image.id}
                  style={{ aspectRatio: image.width && image.height ? `${image.width} / ${image.height}` : fallbackAspect }}
                  onClick={() => onPreview(image.url)}
                >
                  <img src={image.url} alt={`${providerNames.get(job.provider) ?? job.provider} 生成结果`} />
                  <span className="image-hover">Preview</span>
                </button>
              ))}
              {isWaiting
                ? Array.from({ length: Math.max(count, 1) }, (_, index) => (
                    <div
                      className="image-tile image-loading"
                      style={{ aspectRatio: fallbackAspect }}
                      key={`${job.id}-loading-${index}`}
                    >
                      <Icon name="image" />
                      <span>{job.status === 'pending' ? 'Waiting for provider' : 'Rendering image'}</span>
                    </div>
                  ))
                : null}
              {job.status === 'failed' && job.images.length === 0 ? (
                <div className="image-tile image-empty" style={{ aspectRatio: fallbackAspect }}>
                  <Icon name="image" /><span>No image returned</span>
                </div>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function GenerateWorkbench() {
  const apiClient = useMemo(() => createApiClient(), []);
  const pollingRef = useRef<GenerationPollingController | null>(null);
  const runSequenceRef = useRef(0);
  const mountedRef = useRef(true);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const inspectorRef = useRef<HTMLElement | null>(null);
  const providerHealthRef = useRef<HTMLElement | null>(null);

  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providerState, setProviderState] = useState<ProviderLoadState>('loading');
  const [health, setHealth] = useState<HealthView | null>(null);
  const [healthState, setHealthState] = useState<HealthLoadState>('loading');
  const [selectedTargets, setSelectedTargets] = useState<GenerationTarget[]>([]);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [count, setCount] = useState(1);
  const [seed, setSeed] = useState('');
  const [pending, setPending] = useState<PendingGeneration | null>(null);
  const [generation, setGeneration] = useState<GenerationView | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const applyProviders = useCallback((nextProviders: ProviderInfo[]) => {
    setProviders(nextProviders);
    setSelectedTargets((current) => {
      const enabled = new Set(
        nextProviders.flatMap((provider) =>
          provider.models.map((model) => `${provider.id}:${model.model}`),
        ),
      );
      const stillEnabled = current.filter((target) => enabled.has(modelKey(target)));
      return stillEnabled.length > 0
        ? stillEnabled
        : nextProviders.flatMap((provider) =>
            provider.models.map((model) => ({ provider: provider.id, model: model.model })),
          );
    });
  }, []);

  const loadWorkspace = useCallback(async () => {
    setProviderState('loading');
    setHealthState('loading');

    const [providerResult, healthResult] = await Promise.allSettled([
      apiClient.listProviders(),
      apiClient.getHealth(),
    ]);

    if (!mountedRef.current) return;

    if (providerResult.status === 'fulfilled') {
      applyProviders(providerResult.value);
      setProviderState('ready');
    } else {
      setProviderState('error');
    }

    if (healthResult.status === 'fulfilled') {
      setHealth(healthResult.value);
      setHealthState('ready');
    } else {
      setHealth(null);
      setHealthState('error');
    }
  }, [apiClient, applyProviders]);

  const beginPolling = useCallback(async (selfLink: string, sequence: number) => {
    const controller = new GenerationPollingController(apiClient);
    pollingRef.current = controller;

    try {
      const finalView = await controller.start(selfLink, {
        onUpdate: (view) => {
          if (!mountedRef.current || sequence !== runSequenceRef.current) return;
          setGeneration(view);
          if (TERMINAL_STATUSES.has(view.status)) {
            window.localStorage.removeItem(ACTIVE_GENERATION_KEY);
          }
        },
      });
      if (finalView && TERMINAL_STATUSES.has(finalView.status)) {
        window.localStorage.removeItem(ACTIVE_GENERATION_KEY);
      }
    } catch (error) {
      if (mountedRef.current && sequence === runSequenceRef.current) {
        setRunError(error instanceof Error ? error.message : '任务状态更新失败');
      }
    } finally {
      if (mountedRef.current && sequence === runSequenceRef.current) {
        setIsGenerating(false);
      }
    }
  }, [apiClient]);

  useEffect(() => {
    mountedRef.current = true;
    void loadWorkspace();

    const generationId = new URLSearchParams(window.location.search).get('generation');
    const selfLink = generationId
      ? `/api/generations/${encodeURIComponent(generationId)}`
      : window.localStorage.getItem(ACTIVE_GENERATION_KEY);
    if (selfLink) {
      const sequence = ++runSequenceRef.current;
      setIsGenerating(true);
      void apiClient.getGeneration(selfLink).then((view) => {
        if (!mountedRef.current || sequence !== runSequenceRef.current) return;
        setGeneration(view);
        setPending({
          id: view.id,
          status: view.status,
          links: { self: selfLink },
          prompt: view.prompt,
          targets: view.jobs.map((job) => ({ provider: job.provider, model: job.model })),
          count: Math.max(1, ...view.jobs.map((job) => view.images.filter((image) => image.jobId === job.id).length)),
          aspectRatio: '1:1',
        });
        if (TERMINAL_STATUSES.has(view.status)) {
          window.localStorage.removeItem(ACTIVE_GENERATION_KEY);
          setIsGenerating(false);
          return;
        }
        void beginPolling(selfLink, sequence);
      }).catch((error) => {
        window.localStorage.removeItem(ACTIVE_GENERATION_KEY);
        if (mountedRef.current && sequence === runSequenceRef.current) {
          setRunError(error instanceof Error ? error.message : '无法恢复任务');
          setIsGenerating(false);
        }
      });
    }

    return () => {
      mountedRef.current = false;
      pollingRef.current?.cancel();
    };
  }, [apiClient, beginPolling, loadWorkspace]);

  const controls = useMemo(
    () => deriveGenerationControls(providers, selectedTargets),
    [providers, selectedTargets],
  );

  useEffect(() => {
    if (controls.aspectRatios.length > 0 && !controls.aspectRatios.includes(aspectRatio)) {
      setAspectRatio(controls.aspectRatios[0]!);
    }
    if (controls.maxCount > 0 && count > controls.maxCount) {
      setCount(controls.maxCount);
    }
  }, [aspectRatio, controls, count]);

  const providerNames = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider.displayName])),
    [providers],
  );

  const modelNames = useMemo(
    () => new Map(
      providers.flatMap((provider) =>
        provider.models.map((model) => [`${provider.id}:${model.model}`, model.displayName] as const),
      ),
    ),
    [providers],
  );

  const activeJobs = useMemo(
    () => displayJobsFor(generation, pending),
    [generation, pending],
  );

  const toggleTarget = (target: GenerationTarget) => {
    setSelectedTargets((current) => {
      const key = modelKey(target);
      return current.some((item) => modelKey(item) === key)
        ? current.filter((item) => modelKey(item) !== key)
        : [...current, target];
    });
  };

  const handleSubmit = async () => {
    if (!prompt.trim()) {
      setRunError('请先填写提示词');
      promptRef.current?.focus();
      return;
    }

    setRunError(null);
    const sequence = ++runSequenceRef.current;
    pollingRef.current?.cancel();
    setIsGenerating(true);

    try {
      const payload = buildSubmitGenerationRequest(
        {
          prompt: prompt.trim(),
          targets: selectedTargets,
          mode: 'text-to-image',
          aspectRatio,
          count,
          seed: controls.canSetSeed && seed.trim() ? Number(seed) : undefined,
        },
        providers,
      );
      if (payload.seed !== undefined && (!Number.isInteger(payload.seed) || payload.seed < 0)) {
        throw new Error('Seed 必须是大于等于 0 的整数');
      }

      const response = await apiClient.submitGeneration(payload);
      if (!mountedRef.current || sequence !== runSequenceRef.current) return;

      const nextPending = {
        ...response,
        prompt: payload.prompt,
        targets: payload.targets,
        count: payload.count ?? 1,
        aspectRatio: payload.aspectRatio ?? '1:1',
      };
      setGeneration(null);
      setPending(nextPending);
      window.localStorage.setItem(ACTIVE_GENERATION_KEY, response.links.self);
      window.history.replaceState(null, '', `/?generation=${encodeURIComponent(response.id)}`);
      await beginPolling(response.links.self, sequence);
    } catch (error) {
      if (mountedRef.current && sequence === runSequenceRef.current) {
        setRunError(error instanceof Error ? error.message : '任务提交失败');
        setIsGenerating(false);
      }
    }
  };

  const randomizePrompt = () => {
    const choices = RANDOM_PROMPTS.filter((item) => item !== prompt);
    setPrompt(choices[Math.floor(Math.random() * choices.length)] ?? DEFAULT_PROMPT);
  };

  const navigate = (id: typeof NAV_ITEMS[number]['id']) => {
    if (id === 'generate') promptRef.current?.focus();
    if (id === 'models') inspectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (id === 'providers') providerHealthRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const hasActiveGeneration = Boolean(pending || generation);
  const visibleStatus = generation?.status ?? pending?.status;
  const visibleCount = pending?.count ?? count;
  const visibleAspectRatio = pending?.aspectRatio ?? aspectRatio;
  const visibleImageCount = generation?.images.length ?? 0;
  const visibleModelCount = generation?.jobs.length ?? pending?.targets.length ?? 0;
  const healthLabel = healthState === 'loading'
    ? 'Checking backend'
    : healthState === 'ready' && health?.status === 'ok'
      ? 'Backend connected'
      : 'Backend unavailable';

  return (
    <div className="app-shell">
      <aside className="left-rail">
        <nav className="primary-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => (
            <button
              type="button"
              className={item.id === 'generate' ? 'nav-item active' : 'nav-item'}
              key={item.id}
              aria-label={item.label}
              disabled={!item.enabled}
              title={item.enabled ? item.label : `${item.label} 暂未接入`}
              onClick={() => navigate(item.id)}
            >
              <Icon name={item.id} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="rail-footer">
          <span className="version-label">v0.5.0</span>
          <span className="theme-label"><span className="sun-symbol">☼</span> Light</span>
        </div>
      </aside>

      <main className="workspace">
        <header className="page-header">
          <div>
            <h1>Generate</h1>
            <p>Compose a prompt, choose models and settings, and generate images.</p>
          </div>
          <div className={`header-status health-${healthState}`}>
            <span className="live-dot" />
            {healthLabel}
          </div>
        </header>

        <section className="prompt-panel" aria-labelledby="prompt-title">
          <div className="panel-heading">
            <h2 id="prompt-title">Prompt</h2>
            <button type="button" className="text-action" onClick={randomizePrompt}>
              <Icon name="dice" /> Randomize
            </button>
          </div>

          <div className="prompt-field">
            <textarea
              ref={promptRef}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder="描述你想生成的画面……"
              maxLength={2_000}
            />
            <span className="character-count">{prompt.length} / 2000</span>
          </div>

          <div className="generate-row">
            <p>Ready to send to {selectedTargets.length} selected model{selectedTargets.length === 1 ? '' : 's'}.</p>
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => setPrompt('')} disabled={!prompt || isGenerating}>
                Clear
              </button>
              <button
                type="button"
                className="generate-button"
                onClick={() => void handleSubmit()}
                disabled={isGenerating || providerState !== 'ready' || selectedTargets.length === 0 || !prompt.trim()}
              >
                <Icon name="sparkles" />
                {isGenerating ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </div>

          <section className="quick-controls" aria-label="Generation settings">
            <label className="control-group">
              <span className="control-label">Aspect ratio</span>
              <span className="select-control">
                <span className={`ratio-icon ratio-${aspectRatio.replace(':', '-')}`} />
                <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)} disabled={controls.aspectRatios.length === 0 || isGenerating}>
                  {controls.aspectRatios.length > 0
                    ? controls.aspectRatios.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)
                    : <option value="">No shared ratio</option>}
                </select>
              </span>
            </label>

            <label className="control-group compact-control">
              <span className="control-label">Image count</span>
              <span className="select-control">
                <Icon name="image" />
                <select value={count} onChange={(event) => setCount(Number(event.target.value))} disabled={controls.maxCount === 0 || isGenerating}>
                  {Array.from({ length: Math.max(controls.maxCount, 1) }, (_, index) => index + 1).map((value) => (
                    <option value={value} key={value}>{value} per model</option>
                  ))}
                </select>
              </span>
            </label>

            <label className="control-group seed-control">
              <span className="control-label">Seed</span>
              <span className="seed-input">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={seed}
                  onChange={(event) => setSeed(event.target.value)}
                  placeholder={controls.canSetSeed ? 'Random' : 'Unsupported'}
                  disabled={!controls.canSetSeed || isGenerating}
                />
                <button type="button" aria-label="随机 Seed" disabled={!controls.canSetSeed || isGenerating} onClick={() => setSeed(String(Math.floor(Math.random() * 2_147_483_647)))}>
                  <Icon name="dice" />
                </button>
              </span>
            </label>

            <button type="button" className="advanced-link" onClick={() => inspectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              Advanced <span>⌄</span>
            </button>
          </section>
        </section>

        {runError ? (
          <div className="run-error" role="alert">
            <strong>Generation could not continue</strong>
            <span>{runError}</span>
            <button type="button" aria-label="关闭错误提示" onClick={() => setRunError(null)}><Icon name="close" /></button>
          </div>
        ) : null}

        <section className="results-section" aria-labelledby="results-title">
          <h2 id="results-title" className="visually-hidden">Generation results</h2>
          {hasActiveGeneration ? (
            <article className="generation-card">
              <div className="generation-summary">
                <div className="generation-identity">
                  <strong>Job&nbsp; #{(generation?.id ?? pending?.id ?? '').slice(0, 8)}</strong>
                  {visibleStatus ? (
                    <span className={`status-badge status-${visibleStatus}`}><span className="status-dot" />{statusLabel(visibleStatus)}</span>
                  ) : null}
                </div>
                <div className="generation-facts">
                  <span>{generation ? new Date(generation.createdAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Submitted just now'}</span>
                  <span>{visibleImageCount || visibleCount * visibleModelCount} image{(visibleImageCount || visibleCount * visibleModelCount) === 1 ? '' : 's'}</span>
                  <span>{visibleModelCount} model{visibleModelCount === 1 ? '' : 's'}</span>
                </div>
              </div>
              <ResultsGrid
                jobs={activeJobs}
                count={visibleCount}
                aspectRatio={visibleAspectRatio}
                providerNames={providerNames}
                modelNames={modelNames}
                onPreview={setPreviewUrl}
              />
            </article>
          ) : (
            <article className="generation-card results-empty">
              <span className="empty-result-icon"><Icon name="image" /></span>
              <div>
                <h3>No generation yet</h3>
                <p>{providers.length === 0 ? 'Configure a provider in .env, then refresh the connection.' : 'Your first real generation will appear here with live provider status.'}</p>
              </div>
              <button type="button" onClick={() => promptRef.current?.focus()} disabled={providers.length === 0}>Start generating</button>
            </article>
          )}
        </section>

        <section className="provider-health-card" ref={providerHealthRef} aria-label="Provider status">
          <div className="provider-health-summary">
            <strong>Providers status</strong>
            <span><i className={healthState === 'ready' ? 'ok' : 'error'} />{healthLabel}</span>
          </div>
          {providers.map((provider) => (
            <div className="provider-health-item" key={provider.id}>
              <strong>{provider.displayName}</strong>
              <span><i className="configured" />Configured</span>
            </div>
          ))}
          <button type="button" className="refresh-health" onClick={() => void loadWorkspace()}>
            <Icon name="refresh" /> Refresh status
          </button>
        </section>
      </main>

      <aside className="inspector" ref={inspectorRef}>
        <section className="inspector-section">
          <div className="inspector-heading">
            <h2>Models</h2>
            <span>{selectedTargets.length}/{providers.reduce((total, provider) => total + provider.models.length, 0)}</span>
          </div>

          <div className="model-list">
            {providerState === 'loading' ? <p className="inspector-message">Loading models from backend…</p> : null}
            {providerState === 'error' ? (
              <button type="button" className="retry-card" onClick={() => void loadWorkspace()}>
                模型加载失败 · 点击重试
              </button>
            ) : null}
            {providerState === 'ready' && providers.length === 0 ? (
              <div className="empty-models">
                <strong>No provider configured</strong>
                <p>在项目根目录的 .env 中配置 FAL_KEY 或 ZENMUX_API_KEY，然后重新启动服务。</p>
              </div>
            ) : null}
            {providers.flatMap((provider) =>
              provider.models.map((model) => {
                const target = { provider: provider.id, model: model.model };
                const selected = selectedTargets.some((item) => modelKey(item) === modelKey(target));
                return (
                  <button
                    type="button"
                    className={selected ? 'model-card selected' : 'model-card'}
                    key={modelKey(target)}
                    onClick={() => toggleTarget(target)}
                    aria-pressed={selected}
                    disabled={isGenerating}
                  >
                    <span className="model-copy">
                      <small>{provider.displayName}</small>
                      <strong>{model.displayName}</strong>
                    </span>
                    <span className="model-protocol">{model.protocol}</span>
                    <span className="model-check"><span /></span>
                  </button>
                );
              }),
            )}
          </div>
        </section>

        <section className="inspector-section parameters-section">
          <div className="inspector-heading"><h2>Parameters</h2></div>

          <label className="inspector-control">
            <span>Aspect ratio</span>
            <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)} disabled={controls.aspectRatios.length === 0 || isGenerating}>
              {controls.aspectRatios.length > 0
                ? controls.aspectRatios.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)
                : <option value="">No shared ratio</option>}
            </select>
          </label>

          <label className="inspector-control">
            <span>Image count (per model)</span>
            <select value={count} onChange={(event) => setCount(Number(event.target.value))} disabled={controls.maxCount === 0 || isGenerating}>
              {Array.from({ length: Math.max(controls.maxCount, 1) }, (_, index) => index + 1).map((value) => (
                <option value={value} key={value}>{value}</option>
              ))}
            </select>
          </label>

          <label className="inspector-control">
            <span>Seed</span>
            <span className="inspector-seed">
              <input
                type="number"
                min="0"
                step="1"
                value={seed}
                onChange={(event) => setSeed(event.target.value)}
                placeholder={controls.canSetSeed ? 'Random' : 'Unsupported'}
                disabled={!controls.canSetSeed || isGenerating}
              />
              <button type="button" aria-label="随机 Inspector Seed" disabled={!controls.canSetSeed || isGenerating} onClick={() => setSeed(String(Math.floor(Math.random() * 2_147_483_647)))}><Icon name="dice" /></button>
            </span>
          </label>

          <p className="parameter-note">参数来自后端 Provider capabilities；多选模型时仅允许提交共同支持的值。</p>
        </section>

        <section className="inspector-connection">
          <div><Icon name="database" /><span><strong>API connection</strong><small>{healthLabel}</small></span></div>
          <button type="button" aria-label="刷新后端连接" onClick={() => void loadWorkspace()}><Icon name="refresh" /></button>
        </section>
      </aside>

      {previewUrl ? (
        <div className="preview-overlay" role="dialog" aria-modal="true" aria-label="图片预览" onClick={() => setPreviewUrl(null)}>
          <button type="button" className="preview-close" aria-label="关闭预览" onClick={() => setPreviewUrl(null)}><Icon name="close" /></button>
          <img src={previewUrl} alt="生成结果大图预览" onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}
    </div>
  );
}
