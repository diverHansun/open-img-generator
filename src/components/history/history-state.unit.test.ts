import { describe, expect, it } from 'vitest';

import type {
  GenerationSummary,
  HistoryGroup,
  HistoryPage,
} from '@/lib/web-client';

import {
  appendHistoryGroupPage,
  mergeHistoryRefresh,
  parseHistoryPage,
} from './history-state';

function generation(id: string): GenerationSummary {
  return {
    id,
    sessionId: 'session-1',
    prompt: id,
    status: 'completed',
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    jobs: [],
    images: [],
  };
}

function group(items: GenerationSummary[], nextCursor: string | null): HistoryGroup {
  return {
    session: {
      id: 'session-1',
      projectId: 'project-1',
      title: 'Session',
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
    },
    generationCount: 20,
    imageCount: 20,
    lastGenerationAt: '2026-07-20T00:00:00.000Z',
    items,
    nextCursor,
  };
}

function historyPage(historyGroup: HistoryGroup): HistoryPage {
  return {
    projectId: 'project-1',
    page: 1,
    pageSize: 5,
    totalSessions: 1,
    totalPages: 1,
    totals: { generations: 20, images: 20 },
    groups: [historyGroup],
  };
}

describe('history screen state', () => {
  it('accepts only positive safe URL page integers', () => {
    expect(parseHistoryPage('3')).toBe(3);
    expect(parseHistoryPage(null)).toBe(1);
    expect(parseHistoryPage('0')).toBe(1);
    expect(parseHistoryPage('1.5')).toBe(1);
    expect(parseHistoryPage('nope')).toBe(1);
  });

  it('appends unique generation rows and advances the group cursor', () => {
    const result = appendHistoryGroupPage(group([generation('a')], 'old'), {
      items: [generation('a'), generation('b')],
      nextCursor: 'next',
    });
    expect(result.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(result.nextCursor).toBe('next');
  });

  it('refreshes the leading rows without discarding explicitly loaded older rows', () => {
    const current = historyPage(
      group([generation('new'), generation('middle'), generation('old')], 'older'),
    );
    const incoming = historyPage(
      group([generation('latest'), generation('new')], 'first-page'),
    );
    const result = mergeHistoryRefresh(current, incoming);
    expect(result.groups[0]?.items.map((item) => item.id)).toEqual([
      'latest',
      'new',
      'middle',
      'old',
    ]);
    expect(result.groups[0]?.nextCursor).toBe('older');
  });
});
