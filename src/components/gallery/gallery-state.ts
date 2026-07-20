import type { GalleryItem, ProviderId } from '@/lib/web-client';

export const GALLERY_PROVIDER_IDS = [
  'fal',
  'zenmux',
  'siliconflow',
  'zhipu',
  'doubao',
  'qwen',
  'kling',
] as const satisfies ReadonlyArray<ProviderId>;

export type GalleryFilters = {
  workspace?: string;
  provider?: ProviderId;
};

export type ParsedGalleryFilters = {
  filters: GalleryFilters;
  invalid: boolean;
};

export function parseGalleryFilters(
  workspace: string | null,
  provider: string | null,
): ParsedGalleryFilters {
  const normalizedWorkspace = workspace?.trim() || undefined;
  const normalizedProvider = provider?.trim() || undefined;
  const providerIsValid =
    normalizedProvider === undefined ||
    GALLERY_PROVIDER_IDS.includes(normalizedProvider as ProviderId);
  return {
    filters: {
      workspace: normalizedWorkspace,
      provider: providerIsValid
        ? (normalizedProvider as ProviderId | undefined)
        : undefined,
    },
    invalid: !providerIsValid,
  };
}

export function galleryFiltersHref(
  pathname: string,
  filters: GalleryFilters,
): string {
  const params = new URLSearchParams();
  if (filters.workspace) params.set('workspace', filters.workspace);
  if (filters.provider) params.set('provider', filters.provider);
  const query = params.toString();
  return query ? pathname + '?' + query : pathname;
}

export function mergeUniqueGalleryItems(
  leading: ReadonlyArray<GalleryItem>,
  trailing: ReadonlyArray<GalleryItem>,
): GalleryItem[] {
  const seen = new Set<string>();
  return [...leading, ...trailing].filter((item) => {
    if (seen.has(item.imageId)) return false;
    seen.add(item.imageId);
    return true;
  });
}

export function galleryItemMatchesFilters(
  item: GalleryItem,
  filters: GalleryFilters,
): boolean {
  return (
    (!filters.workspace || filters.workspace === item.projectId) &&
    (!filters.provider || filters.provider === item.provider)
  );
}

export type GalleryImageShape = 'portrait' | 'square' | 'landscape' | 'wide';

export function galleryImageShape(
  width: number | null,
  height: number | null,
): GalleryImageShape {
  if (!width || !height || width <= 0 || height <= 0) return 'square';
  const ratio = width / height;
  if (ratio < 0.78) return 'portrait';
  if (ratio > 1.65) return 'wide';
  if (ratio > 1.12) return 'landscape';
  return 'square';
}
