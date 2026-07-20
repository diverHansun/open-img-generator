import { describe, expect, it } from 'vitest';

import type { GalleryItem } from '@/lib/web-client';

import {
  galleryFiltersHref,
  galleryImageShape,
  galleryItemMatchesFilters,
  mergeUniqueGalleryItems,
  parseGalleryFilters,
} from './gallery-state';

function item(imageId: string, projectId = 'project-1', provider = 'qwen'): GalleryItem {
  return {
    favoriteId: 'favorite-' + imageId,
    imageId,
    url: '/api/images/' + imageId,
    width: 1024,
    height: 1024,
    favoritedAt: '2026-07-20T00:00:00.000Z',
    jobId: 'job-1',
    provider,
    model: 'model-1',
    generationId: 'generation-1',
    prompt: imageId,
    sessionId: 'session-1',
    projectId,
    projectTitle: 'Project',
  };
}

describe('gallery screen state', () => {
  it('parses known URL filters and flags an unknown provider', () => {
    expect(parseGalleryFilters(' project-1 ', 'qwen')).toEqual({
      filters: { workspace: 'project-1', provider: 'qwen' },
      invalid: false,
    });
    expect(parseGalleryFilters(null, 'unknown')).toEqual({
      filters: { workspace: undefined, provider: undefined },
      invalid: true,
    });
  });

  it('serializes only active filters', () => {
    expect(
      galleryFiltersHref('/workspace/id/gallery', {
        workspace: 'project one',
        provider: 'fal',
      }),
    ).toBe('/workspace/id/gallery?workspace=project+one&provider=fal');
    expect(galleryFiltersHref('/workspace/id/gallery', {})).toBe(
      '/workspace/id/gallery',
    );
  });

  it('merges cursor pages without duplicate images', () => {
    expect(
      mergeUniqueGalleryItems([item('a'), item('b')], [item('b'), item('c')]).map(
        (entry) => entry.imageId,
      ),
    ).toEqual(['a', 'b', 'c']);
  });

  it('matches active filters and derives stable image shapes', () => {
    expect(
      galleryItemMatchesFilters(item('a'), {
        workspace: 'project-1',
        provider: 'qwen',
      }),
    ).toBe(true);
    expect(
      galleryItemMatchesFilters(item('a'), { workspace: 'project-2' }),
    ).toBe(false);
    expect(galleryImageShape(800, 1200)).toBe('portrait');
    expect(galleryImageShape(1000, 1000)).toBe('square');
    expect(galleryImageShape(1400, 1000)).toBe('landscape');
    expect(galleryImageShape(1800, 1000)).toBe('wide');
  });
});
