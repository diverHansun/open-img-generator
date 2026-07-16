export type ProviderId =
  | 'fal'
  | 'zenmux'
  | 'siliconflow'
  | 'zhipu'
  | 'doubao'
  | 'qwen'
  | 'kling';

export type ProviderMode = 'text-to-image' | 'image-to-image';
export type GenerationStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ProviderCapabilities = {
  providerId: ProviderId;
  model: string;
  displayName: string;
  modes: ProviderMode[];
  maxCount: number;
  supportedSizes: string[];
  supportedAspectRatios: string[];
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  protocol: 'sync' | 'async';
  defaultSize: string;
};

export type ProviderInfo = {
  id: ProviderId;
  displayName: string;
  models: ProviderCapabilities[];
};

export type HealthView = {
  status: 'ok' | 'error';
  enabledProviders: ProviderId[];
  db: 'ok' | 'error';
};

export type GenerationTarget = {
  provider: ProviderId;
  model: string;
};

export type SubmitGenerationRequest = {
  prompt: string;
  targets: GenerationTarget[];
  sessionId: string;
  mode?: ProviderMode;
  width?: number | null;
  height?: number | null;
  aspectRatio?: string | null;
  count?: number | null;
  negativePrompt?: string | null;
  seed?: number | null;
  providerOptions?: Record<string, unknown> | null;
};

export type SubmitGenerationResponse = {
  id: string;
  status: GenerationStatus;
  links: { self: string };
};

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

export type Project = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type Session = {
  id: string;
  projectId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GenerationSummary = Omit<GenerationView, 'jobs' | 'images'> & {
  jobs: Array<{
    id: string;
    provider: ProviderId;
    model: string;
    status: GenerationStatus;
    error: unknown | null;
  }>;
  images: Array<Omit<ImageView, 'index'>>;
};

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

export type GalleryItem = {
  favoriteId: string;
  imageId: string;
  url: string;
  width: number | null;
  height: number | null;
  favoritedAt: string;
  jobId: string;
  provider: string;
  model: string;
  generationId: string;
  prompt: string;
  sessionId: string;
  projectId: string;
  projectTitle: string;
};

export type ModelPreference = {
  provider: string;
  model: string;
  enabled: boolean;
  updatedAt: string;
};
