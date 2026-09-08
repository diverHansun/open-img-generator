import { describe, expect, it, vi } from 'vitest';

import {
  reconcileCompletedFavoriteChange,
  settleFavoriteMutation,
} from './generation-detail-dialog';

describe('generation detail favorite completion', () => {
  it('reconciles the parent after the dialog closes without updating the closed dialog', () => {
    const onFavoriteChange = vi.fn();
    const onSettled = vi.fn();
    const change = { imageId: 'image-1', favorited: true };

    expect(reconcileCompletedFavoriteChange({
      mounted: () => true,
      open: () => false,
      onSettled,
      onFavoriteChange,
      change,
    })).toBe(false);
    expect(onSettled).toHaveBeenCalledOnce();
    expect(onFavoriteChange).toHaveBeenCalledWith(change);
  });

  it('does nothing after the component unmounts', () => {
    const onFavoriteChange = vi.fn();

    expect(reconcileCompletedFavoriteChange({
      mounted: () => false,
      open: () => true,
      onFavoriteChange,
      change: { imageId: 'image-1', favorited: true },
    })).toBe(false);
    expect(onFavoriteChange).not.toHaveBeenCalled();
  });

  it('settles a failed mutation after close without presenting stale feedback', () => {
    const onSettled = vi.fn();

    expect(settleFavoriteMutation({
      mounted: () => true,
      open: () => false,
      onSettled,
    })).toBe(false);
    expect(onSettled).toHaveBeenCalledOnce();
  });
});
