import { describe, it, expect, vi } from 'vitest';
import { GET as getProviders } from '../../src/app/api/providers/route';

vi.mock('../../src/lib/providers', () => ({
  listEnabled: vi.fn(),
}));

import * as providers from '../../src/lib/providers';

describe('GET /api/providers', () => {
  it('returns enabled providers', async () => {
    vi.mocked(providers.listEnabled).mockReturnValue([
      {
        id: 'fal',
        displayName: 'fal.ai',
        models: [
          {
            providerId: 'fal',
            model: 'fal-ai/flux/schnell',
            displayName: 'FLUX Schnell',
            modes: ['text-to-image'],
            maxCount: 4,
            supportedSizes: ['square_hd'],
            supportedAspectRatios: [],
            supportsNegativePrompt: false,
            supportsSeed: true,
            protocol: 'async',
            defaultSize: 'square_hd',
          },
        ],
      },
    ]);

    const response = await getProviders();
    const body = await response.json();

    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('fal');
  });
});
