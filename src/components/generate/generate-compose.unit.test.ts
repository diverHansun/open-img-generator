import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/components/i18n/locale-provider';
import { GenerateCompose, type GenerateComposeProps } from './generate-compose';

// The canvas owns polling; these tests cover its composition with the editor.
vi.mock('./generate-stage', () => ({
  GenerateStage: ({ generationId }: { generationId: string }) =>
    createElement('section', { 'data-test-generation': generationId }),
}));

function render(overrides: Partial<GenerateComposeProps> = {}) {
  const props: GenerateComposeProps = {
    projectId: 'project',
    sessions: [],
    activeSessionId: '',
    sessionBusy: false,
    sessionError: null,
    hasConfiguredProviders: false,
    models: [],
    selectedKeys: new Set(),
    controls: {
      aspectRatios: [], maxCount: 0, canSetSeed: false, canSetNegativePrompt: false,
    },
    prompt: 'Keep this draft',
    aspectRatio: '',
    count: 1,
    countInput: '1',
    seed: '',
    negativePrompt: '',
    formError: null,
    submissionError: null,
    submitting: false,
    currentGenerationId: null,
    currentSnapshot: null,
    onReceiveSnapshot: vi.fn(),
    onBackToCompose: vi.fn(),
    onSessionChange: vi.fn(),
    onCreateSession: vi.fn().mockResolvedValue(null),
    onRenameSession: vi.fn().mockResolvedValue(false),
    onPromptChange: vi.fn(),
    onToggleModel: vi.fn(),
    onAspectRatioChange: vi.fn(),
    onCountChange: vi.fn(),
    onSeedChange: vi.fn(),
    onNegativePromptChange: vi.fn(),
    onClear: vi.fn(),
    onSubmit: vi.fn(),
    onSubmissionAction: vi.fn(),
    ...overrides,
  };
  return renderToStaticMarkup(
    createElement(LocaleProvider, null, createElement(GenerateCompose, props)),
  );
}

describe('unified generation workbench', () => {
  it('keeps the prompt, session and model controls beside an existing result', () => {
    const html = render({ currentGenerationId: 'generation-1' });
    expect(html).toContain('data-test-generation="generation-1"');
    expect(html).toContain('id="generation-prompt"');
    expect(html).toContain('Keep this draft');
    expect(html).toContain('<select');
    expect(html).toContain('/workspace/project/providers');
    expect(html).toContain('/workspace/project/models');
  });

  it('keeps both the prior result and draft visible during a new submission or error', () => {
    for (const state of [
      { submitting: true },
      { submissionError: { messageKey: 'generate.submitError', action: 'wait' } } as const,
    ]) {
      const html = render({ currentGenerationId: 'previous', ...state });
      expect(html).toContain('data-test-generation="previous"');
      expect(html).toContain('Keep this draft');
      expect(html).toContain('id="generation-prompt"');
    }
  });

  it('uses one count input without duplicate preset buttons and keeps range validation', () => {
    const html = render({
      controls: {
        aspectRatios: ['1:1'], maxCount: 4, canSetSeed: true, canSetNegativePrompt: false,
      },
      countInput: '5',
    });
    expect(html.match(/id="generation-count"/g)).toHaveLength(1);
    expect(html).toContain('max="4"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="generation-count-hint"');
    expect(html).not.toMatch(/<button\b[^>]*>[1-4]<\/button>/);
  });

  it('exposes an accessible resizer and no decorative dot in the idle title', () => {
    const html = render();
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-valuenow="356"');
    expect(html).toContain('aria-controls=');
    expect(html).toContain('调整生成区宽度');
    expect(html).not.toContain('standbyDot');
  });

  it('renders an idle canvas without dropping the editor when a task is dismissed', () => {
    const html = render();
    expect(html).not.toContain('data-test-generation');
    expect(html).toContain('Keep this draft');
    expect(html).toContain('当前任务');
  });
});
