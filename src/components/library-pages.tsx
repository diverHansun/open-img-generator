'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ApiClient,
  GalleryItem,
  GenerationSummary,
  HealthView,
  ModelPreference,
  ProviderInfo,
} from '@/lib/web-client';

export type LibraryView = 'history' | 'gallery' | 'models' | 'providers';

type SharedPageProps = {
  apiClient: ApiClient;
  currentSessionId: string;
  onPreview: (url: string) => void;
  onOpenGeneration: (id: string) => void;
};

export function LibraryPage({
  view,
  apiClient,
  currentSessionId,
  providers,
  health,
  healthLabel,
  onPreview,
  onOpenGeneration,
}: SharedPageProps & {
  view: LibraryView;
  providers: ProviderInfo[];
  health: HealthView | null;
  healthLabel: string;
}) {
  if (view === 'history') {
    return (
      <HistoryPage
        apiClient={apiClient}
        currentSessionId={currentSessionId}
        onPreview={onPreview}
        onOpenGeneration={onOpenGeneration}
      />
    );
  }
  if (view === 'gallery') {
    return <GalleryPage apiClient={apiClient} onPreview={onPreview} onOpenGeneration={onOpenGeneration} />;
  }
  if (view === 'models') return <ModelsPage apiClient={apiClient} />;
  return <ProvidersPage providers={providers} health={health} healthLabel={healthLabel} />;
}

function HistoryPage({
  apiClient,
  currentSessionId,
  onPreview,
  onOpenGeneration,
}: SharedPageProps) {
  const [items, setItems] = useState<GenerationSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cursor?: string) => {
    if (!currentSessionId) {
      setItems([]);
      setNextCursor(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const page = await apiClient.listGenerations({
        sessionId: currentSessionId,
        limit: 10,
        cursor,
      });
      setItems((current) => (cursor ? [...current, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'History 加载失败');
    } finally {
      setLoading(false);
    }
  }, [apiClient, currentSessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="library-page" aria-labelledby="history-page-title">
      <div className="library-page-heading">
        <div>
          <h2 id="history-page-title">History</h2>
          <p>当前 Session 的生成记录；列表请求只读，不会推进 Provider poll。</p>
        </div>
        <button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {!currentSessionId ? <EmptyState title="Select a Session first" detail="History 按 Project → Session 查看。" /> : null}
      {error ? <InlineError message={error} onRetry={() => void load()} /> : null}
      {currentSessionId && !error && items.length === 0 && !loading ? (
        <EmptyState title="No generations yet" detail="提交一次生成后，最近记录会出现在这里。" />
      ) : null}
      <div className="history-list">
        {items.map((item) => (
          <article className="history-item" key={item.id}>
            <div className="history-item-copy">
              <div className="library-item-meta">
                <strong>#{item.id.slice(0, 8)}</strong>
                <StatusBadge status={item.status} />
                <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
              </div>
              <p>{item.prompt}</p>
              <div className="history-job-line">
                {item.jobs.map((job) => (
                  <span key={job.id}>{job.provider} / {job.model} · {job.status}</span>
                ))}
              </div>
            </div>
            <div className="history-item-images">
              {item.images.slice(0, 4).map((image) => (
                <button
                  type="button"
                  className="library-thumb"
                  key={image.id}
                  onClick={() => onPreview(image.url)}
                  aria-label="Preview history image"
                >
                  <img src={image.url} alt="History result" />
                </button>
              ))}
              <button type="button" className="secondary-button" onClick={() => onOpenGeneration(item.id)}>
                Open detail
              </button>
            </div>
          </article>
        ))}
      </div>
      {nextCursor ? (
        <button type="button" className="secondary-button library-load-more" onClick={() => void load(nextCursor)} disabled={loading}>
          Load older
        </button>
      ) : null}
    </section>
  );
}

function GalleryPage({
  apiClient,
  onPreview,
  onOpenGeneration,
}: Pick<SharedPageProps, 'apiClient' | 'onPreview' | 'onOpenGeneration'>) {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cursor?: string) => {
    setLoading(true);
    setError(null);
    try {
      const page = await apiClient.listFavorites({ limit: 48, cursor });
      setItems((current) => (cursor ? [...current, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Gallery 加载失败');
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (imageId: string) => {
    try {
      await apiClient.removeFavorite(imageId);
      setItems((current) => current.filter((item) => item.imageId !== imageId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '取消收藏失败');
    }
  };

  return (
    <section className="library-page" aria-labelledby="gallery-page-title">
      <div className="library-page-heading">
        <div>
          <h2 id="gallery-page-title">Gallery</h2>
          <p>收藏的是单张 Image；每个条目都保留 generation、job、session 和 project 回溯。</p>
        </div>
        <button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {error ? <InlineError message={error} onRetry={() => void load()} /> : null}
      {!error && items.length === 0 && !loading ? (
        <EmptyState title="Gallery is empty" detail="在生成结果或 History 中点击收藏图标。" />
      ) : null}
      <div className="gallery-grid">
        {items.map((item) => (
          <article className="gallery-card" key={item.favoriteId}>
            <button type="button" className="gallery-image" onClick={() => onPreview(item.url)}>
              <img src={item.url} alt={item.prompt} />
            </button>
            <div className="gallery-card-copy">
              <strong>{item.provider} / {item.model}</strong>
              <p>{item.prompt}</p>
              <small>{item.projectTitle} · {formatDate(item.favoritedAt)}</small>
            </div>
            <div className="gallery-card-actions">
              <button type="button" className="text-action" onClick={() => onOpenGeneration(item.generationId)}>
                Open generation
              </button>
              <button type="button" className="text-action danger-action" onClick={() => void remove(item.imageId)}>
                Unfavorite
              </button>
            </div>
          </article>
        ))}
      </div>
      {nextCursor ? (
        <button type="button" className="secondary-button library-load-more" onClick={() => void load(nextCursor)} disabled={loading}>
          Load older
        </button>
      ) : null}
    </section>
  );
}

function ModelsPage({ apiClient }: Pick<SharedPageProps, 'apiClient'>) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [preferences, setPreferences] = useState<ModelPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [providerResult, preferenceResult] = await Promise.all([
        apiClient.listProviders(),
        apiClient.listModelPreferences(),
      ]);
      setProviders(providerResult);
      setPreferences(preferenceResult.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Models 加载失败');
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  useEffect(() => {
    void load();
  }, [load]);

  const preferenceMap = useMemo(
    () => new Map(preferences.map((preference) => [`${preference.provider}:${preference.model}`, preference.enabled])),
    [preferences],
  );

  const toggle = async (provider: string, model: string) => {
    const key = `${provider}:${model}`;
    const enabled = preferenceMap.get(key) !== false;
    try {
      const next = await apiClient.upsertModelPreference({ provider, model, enabled: !enabled });
      setPreferences((current) => [
        ...current.filter((item) => `${item.provider}:${item.model}` !== key),
        next,
      ]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '模型偏好保存失败');
    }
  };

  return (
    <section className="library-page" aria-labelledby="models-page-title">
      <div className="library-page-heading">
        <div>
          <h2 id="models-page-title">Models</h2>
          <p>关闭的模型不会出现在 Generate 当次勾选池；没有偏好记录时默认启用。</p>
        </div>
        <button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {error ? <InlineError message={error} onRetry={() => void load()} /> : null}
      <div className="models-page-list">
        {providers.flatMap((provider) => provider.models.map((model) => {
          const key = `${provider.id}:${model.model}`;
          const enabled = preferenceMap.get(key) !== false;
          return (
            <div className="model-page-row" key={key}>
              <div>
                <small>{provider.displayName} · {model.protocol}</small>
                <strong>{model.displayName}</strong>
                <span>{model.model}</span>
              </div>
              <button
                type="button"
                className={enabled ? 'toggle-button enabled' : 'toggle-button'}
                onClick={() => void toggle(provider.id, model.model)}
                disabled={loading}
                aria-pressed={enabled}
              >
                {enabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          );
        }))}
      </div>
      {!loading && providers.length === 0 ? <EmptyState title="No provider configured" detail="配置 Provider key 后刷新。" /> : null}
    </section>
  );
}

function ProvidersPage({
  providers,
  health,
  healthLabel,
}: {
  providers: ProviderInfo[];
  health: HealthView | null;
  healthLabel: string;
}) {
  return (
    <section className="library-page" aria-labelledby="providers-page-title">
      <div className="library-page-heading">
        <div>
          <h2 id="providers-page-title">Providers</h2>
          <p>只读展示后端配置状态；Provider key 仍只存在服务端环境变量。</p>
        </div>
        <span className="status-badge"><span className="status-dot" />{healthLabel}</span>
      </div>
      <div className="provider-page-list">
        {providers.map((provider) => (
          <article className="provider-page-row" key={provider.id}>
            <div>
              <strong>{provider.displayName}</strong>
              <span>{provider.models.length} enabled model{provider.models.length === 1 ? '' : 's'}</span>
            </div>
            <span className={`status-badge ${health?.enabledProviders.includes(provider.id) ? 'status-completed' : 'status-failed'}`}>
              <span className="status-dot" />{health?.enabledProviders.includes(provider.id) ? 'Configured' : 'Unavailable'}
            </span>
          </article>
        ))}
      </div>
      {providers.length === 0 ? <EmptyState title="No provider configured" detail="配置 FAL_KEY 或 ZENMUX_API_KEY 后刷新。" /> : null}
    </section>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="library-empty">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="library-inline-error" role="alert">
      <span>{message}</span>
      <button type="button" className="text-action" onClick={onRetry}>Retry</button>
    </div>
  );
}

function StatusBadge({ status }: { status: GenerationSummary['status'] }) {
  return (
    <span className={`status-badge status-${status}`}>
      <span className="status-dot" />{status}
    </span>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
