import type { ProviderId, ProviderMode } from '../providers/types';

export type GenerationTarget = {
  provider: ProviderId;
  model: string;
};

export type SubmitGenerationParams = {
  targets: GenerationTarget[];
  prompt: string;
  sessionId: string;
  mode?: ProviderMode;
  width?: number;
  height?: number;
  aspectRatio?: string;
  count?: number;
  negativePrompt?: string;
  seed?: number;
  providerOptions?: Record<string, unknown>;
};

export type GenerationStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type JobView = {
  id: string;
  provider: ProviderId;
  model: string;
  status: GenerationStatus;
  error?: { code: string; message: string; retryable: boolean };
};

export type ImageView = {
  id: string;
  jobId: string;
  index: number;
  url: string;
  width: number | null;
  height: number | null;
};

export type GenerationView = {
  id: string;
  sessionId: string;
  prompt: string;
  status: GenerationStatus;
  createdAt: string;
  updatedAt: string;
  jobs: JobView[];
  images: ImageView[];
};
