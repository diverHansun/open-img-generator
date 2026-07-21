import type {
  ProviderDiagnostic,
  ProviderId,
  ProviderMode,
} from '../providers/types';
import type { StorageDiagnostic } from '../errors';

export type GenerationTarget = {
  provider: ProviderId;
  model: string;
};

export type SubmitGenerationParams = {
  /** Stable browser/user intent identity used for durable admission replay. */
  clientRequestId: string;
  targets: GenerationTarget[];
  prompt: string;
  sessionId: string;
  mode?: ProviderMode;
  width?: number | null;
  height?: number | null;
  aspectRatio?: string | null;
  count?: number | null;
  negativePrompt?: string | null;
  seed?: number | null;
  referenceImages?: string[] | null;
  providerOptions?: Record<string, unknown> | null;
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
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    diagnostic?: ProviderDiagnostic;
    storageDiagnostic?: StorageDiagnostic;
  };
  /** True only for a durable, explicitly rate-limited Provider wait. */
  waitingForProvider?: boolean;
  /** Safe local schedule metadata; never a raw Provider header. */
  nextAttemptAt?: string;
};

export type ImageView = {
  id: string;
  jobId: string;
  index: number;
  url: string | null;
  width: number | null;
  height: number | null;
  favorited: boolean;
  availability:
    | 'available'
    | 'retention_expired'
    | 'user_deleted'
    | 'storage_missing';
  removedAt: string | null;
};

export type VideoView = {
  id: string;
  jobId: string;
  index: number;
  url: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  availability: 'available' | 'retention_expired' | 'user_deleted' | 'storage_missing';
  removedAt: string | null;
};

export type GenerationView = {
  id: string;
  sessionId: string;
  projectId: string;
  prompt: string;
  status: GenerationStatus;
  mediaKind?: 'image' | 'video';
  createdAt: string;
  updatedAt: string;
  jobs: JobView[];
  images: ImageView[];
  videos?: VideoView[];
};
