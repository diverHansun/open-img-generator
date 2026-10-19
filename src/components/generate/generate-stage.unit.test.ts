import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/components/i18n/locale-provider';
import type { GenerationView } from '@/lib/web-client';
import { GenerateStage } from './generate-stage';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/shell/workspace-notices', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/shell/workspace-notices')>(),
  useWorkspaceNotices: () => ({ showWorkspaceNotice: vi.fn() }),
}));
vi.mock('@/lib/web-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/web-client')>(),
  getBrowserWebClientRuntime: () => ({ client: {}, generationPollRegistry: {} }),
}));

const fixture: GenerationView = {
  id: 'generation', projectId: 'project', sessionId: 'session', prompt: 'A studio photograph',
  status: 'running', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  jobs: [
    { id: 'job-a', provider: 'fal', model: 'flux', status: 'running' },
    { id: 'job-b', provider: 'siliconflow', model: 'kolors', status: 'pending' },
  ],
  images: [],
};

function render(snapshot: GenerationView) {
  return renderToStaticMarkup(createElement(LocaleProvider, null, createElement(GenerateStage, {
    projectId: 'project', generationId: 'generation', initialSnapshot: snapshot,
    onSnapshot: vi.fn(), onBack: vi.fn(),
  })));
}

describe('generation waiting imagery', () => {
  it('uses a pigment frame for every active task, without image spinners or a header dot', () => {
    const html = render(fixture);
    expect(html.match(/data-generation-placeholder=/g)).toHaveLength(2);
    expect(html).toContain('fal · flux');
    expect(html).toContain('生成中');
    expect(html).toContain('等待中');
    expect(html).not.toContain('lucide-loader-circle');
    expect(html.match(/<header[\s\S]*?<\/header>/)?.[0]).not.toContain('statusDot');
    expect(html).not.toContain('role="progressbar"');
    expect(html).toContain('aria-live="polite"');
  });

  it('keeps returned images intact and uses the same material for pending thumbnails', () => {
    const html = render({
      ...fixture,
      jobs: [{ ...fixture.jobs[0]!, status: 'completed' }, fixture.jobs[1]!],
      images: [{
        id: 'image', jobId: 'job-a', index: 0, url: '/image.png', width: 960, height: 640,
        favorited: false, availability: 'available', removedAt: null,
      }],
    });
    expect(html).toContain('src="/image.png"');
    expect(html.match(/data-generation-placeholder=/g)).toHaveLength(1);
    expect(html).toContain('data-generation-placeholder="job-b"');
    expect(html).not.toContain('lucide-loader-circle');
  });

  it('opens on the gallery, where each image focuses in place', () => {
    const html = render({
      ...fixture,
      jobs: [{ ...fixture.jobs[0]!, status: 'completed' }, fixture.jobs[1]!],
      images: [{
        id: 'image', jobId: 'job-a', index: 0, url: '/image.png', width: 960, height: 640,
        favorited: false, availability: 'available', removedAt: null,
      }],
    });
    expect(html).toContain('data-gallery-image="image"');
    expect(html).toContain('aria-label="聚焦查看第 1 张图片"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>[\s\S]*?网格/);
  });

  it('gives each waiting frame its own light', () => {
    const html = render(fixture);
    const styles = [...html.matchAll(/data-generation-placeholder="[^"]+"[^>]*style="([^"]+)"/g)].map((m) => m[1]);
    expect(styles).toHaveLength(2);
    expect(styles[0]).toContain('--light-c1');
    expect(styles[0]).not.toBe(styles[1]);
  });

  it.each(['completed', 'cancelled', 'failed'] as const)('stops waiting imagery when the task is %s', (status) => {
    const html = render({ ...fixture, status, jobs: fixture.jobs.map(job => ({ ...job, status })) });
    expect(html).not.toContain('data-generation-placeholder');
    expect(html).not.toContain('lucide-loader-circle');
  });
});
