import { describe, expect, it } from 'vitest';

import type { GenerationView, ProviderInfo } from '@/lib/web-client';

import {
  buildAvailableModelTargets,
  clampGenerateCount,
  createInitialGenerateTaskState,
  generateTaskReducer,
  parseGenerateCountInput,
  restoreGenerateConfiguration,
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

  it('restores composition settings and discards no-longer-available models', () => {
    const models = buildAvailableModelTargets(providers, []);

    expect(
      restoreGenerateConfiguration(
        JSON.stringify({
          selectedKeys: ['fal:flux', 'retired:model', 'fal:flux'],
          aspectRatio: '3:2',
          count: 3,
          seed: '42',
          negativePrompt: 'blurry',
        }),
        models,
      ),
    ).toEqual({
      selectedKeys: ['fal:flux'],
      aspectRatio: '3:2',
      count: 3,
      seed: '42',
      negativePrompt: 'blurry',
    });
  });

  it('falls back to the first available model for missing or invalid settings', () => {
    const models = buildAvailableModelTargets(providers, []);

    expect(restoreGenerateConfiguration(null, models)).toMatchObject({
      selectedKeys: ['fal:flux'],
      count: 1,
    });
    expect(restoreGenerateConfiguration('{bad json', models)).toMatchObject({
      selectedKeys: ['fal:flux'],
      count: 1,
    });
  });

  it('accepts only whole count values inside the current model range', () => {
    expect(parseGenerateCountInput('4', 4)).toBe(4);
    expect(parseGenerateCountInput('5', 4)).toBeNull();
    expect(parseGenerateCountInput('0', 4)).toBeNull();
    expect(parseGenerateCountInput('', 4)).toBeNull();
    expect(parseGenerateCountInput('1.5', 4)).toBeNull();
    expect(clampGenerateCount(5, 4)).toBe(4);
    expect(clampGenerateCount(0, 4)).toBe(1);
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
