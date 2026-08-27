import type { ProviderId } from './types';

export type GalleryBrowseQuery = {
  workspace?: string;
  provider?: ProviderId;
  cursor?: string;
};

/**
 * Filters are URL-owned. A changed filter always clears its cursor so the
 * browser cannot append a page from a previous result set.
 */
export function updateGalleryBrowseQuery(
  current: GalleryBrowseQuery,
  patch: Partial<Pick<GalleryBrowseQuery, 'workspace' | 'provider'>>,
): GalleryBrowseQuery {
  const next = { ...current, ...patch };
  if (
    next.workspace !== current.workspace ||
    next.provider !== current.provider
  ) {
    delete next.cursor;
  }
  return next;
}

export function toFavoritesQuery(query: GalleryBrowseQuery): {
  projectId?: string;
  provider?: ProviderId;
  cursor?: string;
  sort: 'newest';
} {
  return {
    projectId: query.workspace,
    provider: query.provider,
    cursor: query.cursor,
    sort: 'newest',
  };
}
