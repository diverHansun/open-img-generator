import { describe, expect, it } from 'vitest';

import type { GenerationView, ProviderInfo } from '@/lib/web-client';

import {
  buildAvailableModelTargets,
  createInitialGenerateTaskState,
  generateTaskReducer,
  summarizeGeneration,
} from './generate-state';

const providers: ProviderInfo[] = [
  {
    id: 'fal',
    displayName: 'fal.ai',
    models: [
      {
        providerId: 'fal',
        model: 'flux',
        displayName: 'FLUX',
        modes: ['text-to-image'],
        maxCount: 4,
        supportedSizes: ['square'],
        supportedAspectRatios: ['1:1'],
        supportsNegativePrompt: false,
        supportsSeed: true,
        protocol: 'async',
        defaultSize: 'square',
      },
    ],
  },
];

describe('generate state', () => {
  it('uses enabled-by-default preferences and removes explicit disabled models', () => {
    expect(buildAvailableModelTargets(providers, [])).toHaveLength(1);
    expect(
      buildAvailableModelTargets(providers, [
        { provider: 'fal', model: 'flux', enabled: false, updatedAt: 'now' },
      ]),
    ).toEqual([]);
  });

  it('ignores stale submit responses and preserves the current task on back', () => {
    let state = createInitialGenerateTaskState('old');
    state = generateTaskReducer(state, { type: 'submit-started', sequence: 2 });
    expect(
      generateTaskReducer(state, {
        type: 'submit-succeeded',
        sequence: 1,
        generationId: 'stale',
      }),
    ).toEqual(state);
    state = generateTaskReducer(state, {
      type: 'submit-succeeded',
      sequence: 2,
      generationId: 'new',
    });
    expect(state.currentGenerationId).toBe('new');
    expect(generateTaskReducer(state, { type: 'back-to-compose' })).toMatchObject({
      view: 'compose',
      currentGenerationId: 'new',
    });
  });

  it('derives partial completion only from terminal mixed jobs', () => {
    const view: GenerationView = {
      id: 'g',
      sessionId: 's',
      projectId: 'p',
      prompt: 'prompt',
      status: 'completed',
      createdAt: 'now',
      updatedAt: 'now',
      jobs: [
        { id: 'a', provider: 'fal', model: 'flux', status: 'completed' },
        { id: 'b', provider: 'fal', model: 'flux', status: 'failed' },
      ],
      images: [],
    };
    expect(summarizeGeneration(view).displayStatus).toBe('partial');
  });
});
