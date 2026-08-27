'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import type { GenerationView, ProviderInfo, Session } from '@/lib/web-client';

type VideoModel = { provider: string; model: string; label: string };

export function VideoGenerateScreen({ projectId }: { projectId: string }) {
  const [sessions, setSessions] = React.useState<Session[]>([]);
  const [sessionId, setSessionId] = React.useState('');
  const [models, setModels] = React.useState<VideoModel[]>([]);
  const [modelKey, setModelKey] = React.useState('');
  const [prompt, setPrompt] = React.useState('');
  const [aspectRatio, setAspectRatio] = React.useState('16:9');
  const [generation, setGeneration] = React.useState<GenerationView | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void Promise.all([
      fetch(`/api/projects/${encodeURIComponent(projectId)}/sessions`).then((res) => res.json()),
      fetch('/api/providers').then((res) => res.json()),
    ]).then(([sessionRows, providerRows]: [Session[], ProviderInfo[]]) => {
      setSessions(sessionRows);
      setSessionId(sessionRows[0]?.id ?? '');
      const videoModels = providerRows.flatMap((provider) => provider.models
        .filter((model) => (model.mediaKind ?? 'image') === 'video')
        .map((model) => ({
          provider: provider.id,
          model: model.model,
          label: `${provider.displayName} · ${model.displayName}`,
        })));
      setModels(videoModels);
      setModelKey(videoModels[0] ? `${videoModels[0].provider}:${videoModels[0].model}` : '');
    }).catch(() => setError('无法加载视频模型或会话。'));
  }, [projectId]);

  React.useEffect(() => {
    if (!generation || ['completed', 'failed', 'cancelled'].includes(generation.status)) return;
    const timer = window.setTimeout(() => {
      void fetch(`/api/generations/${generation.id}`)
        .then((res) => res.json())
        .then(setGeneration)
        .catch(() => setError('轮询任务状态失败。'));
    }, 3_000);
    return () => window.clearTimeout(timer);
  }, [generation]);

  async function submit() {
    const selected = models.find((item) => `${item.provider}:${item.model}` === modelKey);
    if (!selected || !sessionId || !prompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/video-generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientRequestId: crypto.randomUUID(),
          sessionId,
          prompt,
          aspectRatio,
          targets: [{ provider: selected.provider, model: selected.model }],
        }),
      });
      const submitted = await response.json();
      if (!response.ok) throw new Error(submitted.error?.message ?? '提交失败');
      const detail = await fetch(submitted.links.self).then((res) => res.json());
      setGeneration(detail);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提交失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px', display: 'grid', gap: 20 }}>
      <header>
        <p style={{ margin: 0, opacity: 0.65 }}>Video Generation</p>
        <h1>Seedance 文生视频</h1>
        <p>异步任务完成后会立即转存为本地 MP4；刷新页面不会丢失任务。</p>
      </header>
      <label>会话
        <select value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
          {sessions.map((session) => <option key={session.id} value={session.id}>{session.title || '未命名会话'}</option>)}
        </select>
      </label>
      <label>模型
        <select value={modelKey} onChange={(event) => setModelKey(event.target.value)}>
          {models.map((model) => <option key={`${model.provider}:${model.model}`} value={`${model.provider}:${model.model}`}>{model.label}</option>)}
        </select>
      </label>
      <label>画幅
        <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>
          {['16:9', '9:16', '1:1', '4:3', '3:4'].map((ratio) => <option key={ratio}>{ratio}</option>)}
        </select>
      </label>
      <label>提示词
        <textarea rows={7} value={prompt} onChange={(event) => setPrompt(event.target.value)} style={{ width: '100%' }} />
      </label>
      <Button disabled={busy || !modelKey || !sessionId || !prompt.trim()} onClick={() => void submit()}>
        {busy ? '正在提交…' : '生成视频'}
      </Button>
      {models.length === 0 ? <p>尚未配置 ARK_API_KEY，或当前没有已启用的视频模型。</p> : null}
      {error ? <p role="alert" style={{ color: '#b42318' }}>{error}</p> : null}
      {generation ? (
        <section>
          <h2>任务：{generation.status}</h2>
          {generation.jobs.map((job) => <p key={job.id}>{job.model} · {job.status}{job.error ? ` · ${job.error.message}` : ''}</p>)}
          {generation.videos?.map((video) => video.url ? (
            <video key={video.id} src={video.url} controls playsInline style={{ width: '100%', maxHeight: 600 }} />
          ) : <p key={video.id}>视频已清理。</p>)}
        </section>
      ) : null}
    </main>
  );
}
