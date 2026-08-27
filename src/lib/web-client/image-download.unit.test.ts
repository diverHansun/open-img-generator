import { afterEach, describe, expect, it, vi } from 'vitest';

import { imageDownloadUrl, triggerImageDownload } from './image-download';

describe('browser image download handoff', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates a repeatable same-origin download link in a new tab', () => {
    const click = vi.fn();
    const remove = vi.fn();
    const anchor = {
      href: '', download: 'unset', target: '', rel: '', hidden: false,
      click, remove,
    };
    const append = vi.fn();
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { append },
    });

    triggerImageDownload('image/with spaces');

    expect(anchor).toMatchObject({
      href: '/api/images/image%2Fwith%20spaces/download',
      download: '',
      target: '_blank',
      rel: 'noopener noreferrer',
      hidden: true,
    });
    expect(append).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(imageDownloadUrl('image-1')).toBe('/api/images/image-1/download');
  });
});
