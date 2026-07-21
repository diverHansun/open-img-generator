import type {
  GenerationStatus,
  GenerationTarget,
  GenerationView,
  ModelPreference,
  ProviderInfo,
} from '@/lib/web-client';

export type AvailableModelTarget = {
  target: GenerationTarget;
  providerName: string;
  displayName: string;
  protocol: 'sync' | 'async';
};

export function buildAvailableModelTargets(
  providers: ProviderInfo[],
  preferences: ModelPreference[],
): AvailableModelTarget[] {
  const preferenceLookup = new Map(
    preferences.map((item) => [item.provider + ':' + item.model, item.enabled]),
  );
  return providers.flatMap((provider) =>
    provider.models
      .filter(
        (model) =>
          (model.mediaKind ?? 'image') === 'image' &&
          preferenceLookup.get(provider.id + ':' + model.model) !== false,
      )
      .map((model) => ({
        target: { provider: provider.id, model: model.model },
        providerName: provider.displayName,
        displayName: model.displayName,
        protocol: model.protocol,
      })),
  );
}

export type GenerateTaskState = {
  view: 'compose' | 'stage';
  currentGenerationId: string | null;
  snapshot: GenerationView | null;
  submissionSequence: number;
};

export type GenerateTaskAction =
  | { type: 'submit-started'; sequence: number }
  | { type: 'submit-succeeded'; sequence: number; generationId: string }
  | { type: 'open-stage'; generationId: string }
  | { type: 'snapshot-received'; generationId: string; snapshot: GenerationView }
  | { type: 'back-to-compose' };

export function createInitialGenerateTaskState(
  generationId?: string | null,
): GenerateTaskState {
  return {
    view: generationId ? 'stage' : 'compose',
    currentGenerationId: generationId ?? null,
    snapshot: null,
    submissionSequence: 0,
  };
}

export function generateTaskReducer(
  state: GenerateTaskState,
  action: GenerateTaskAction,
): GenerateTaskState {
  switch (action.type) {
    case 'submit-started':
      return { ...state, submissionSequence: action.sequence };
    case 'submit-succeeded':
      if (action.sequence !== state.submissionSequence) return state;
      return {
        ...state,
        view: 'stage',
        currentGenerationId: action.generationId,
        snapshot: null,
      };
    case 'open-stage':
      return {
        ...state,
        view: 'stage',
        currentGenerationId: action.generationId,
        snapshot:
          state.currentGenerationId === action.generationId
            ? state.snapshot
            : null,
      };
    case 'snapshot-received':
      if (state.currentGenerationId !== action.generationId) return state;
      return { ...state, snapshot: action.snapshot };
    case 'back-to-compose':
      return { ...state, view: 'compose' };
  }
}

export type GenerationJobSummary = {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  imageCount: number;
  displayStatus: GenerationStatus | 'partial';
};

export function summarizeGeneration(view: GenerationView): GenerationJobSummary {
  const summary = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const job of view.jobs) summary[job.status] += 1;
  const terminalCount = summary.completed + summary.failed + summary.cancelled;
  const displayStatus =
    terminalCount === view.jobs.length &&
    summary.completed > 0 &&
    summary.failed + summary.cancelled > 0
      ? 'partial'
      : view.status;
  return {
    ...summary,
    imageCount: view.images.length,
    displayStatus,
  };
}
