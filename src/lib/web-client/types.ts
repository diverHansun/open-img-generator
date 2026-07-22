import type { ProviderDiagnostic } from '../providers/error-diagnostics';

export type ProviderId =
  | 'fal'
  | 'zenmux'
  | 'siliconflow'
  | 'zhipu'
  | 'doubao'
  | 'qwen';

export type ProviderMode = 'text-to-image' | 'image-to-image' | 'text-to-video';
export type GenerationStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ImageAvailability =
  | 'available'
  | 'retention_expired'
  | 'user_deleted'
  | 'storage_missing';

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
  mediaKind?: 'image' | 'video';
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
  schema?: {
    currentVersion: number;
    requiredVersion: number;
    foreignKeysEnabled?: boolean;
    missingTables?: string[];
    missingColumns?: string[];
    missingIndexes?: string[];
  };
  error?: ApiErrorBody['error'];
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    requestId?: string;
    details?: Record<string, unknown>;
  };
};

export type GenerationTarget = {
  provider: ProviderId;
  model: string;
};

/** The content of a user generation intention before it receives a stable key. */
export type SubmitGenerationPayload = {
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
  referenceImages?: string[] | null;
  providerOptions?: Record<string, unknown> | null;
};

export type SubmitGenerationRequest = SubmitGenerationPayload & {
  /** Stable UUID reused after a lost response; must match Idempotency-Key. */
  clientRequestId: string;
};

export type SubmitGenerationResponse = {
  id: string;
  status: GenerationStatus;
  replayed: boolean;
  links: { self: string };
};

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
    storageDiagnostic?: {
      category:
        | 'remote_url_invalid'
        | 'remote_dns_failed'
        | 'remote_address_blocked'
        | 'proxy_mapping_not_trusted'
        | 'remote_download_timeout'
        | 'remote_download_failed'
        | 'remote_http_rejected'
        | 'remote_content_invalid'
        | 'local_write_failed';
      hostname?: string;
    };
  };
  waitingForProvider?: boolean;
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
  videos?: Array<{
    id: string;
    jobId: string;
    index: number;
    url: string | null;
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
    availability: ImageView['availability'];
    removedAt: string | null;
  }>;
};

export type Project = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSummary = {
  project: Project;
  sessionCount: number;
  generationCount: number;
  imageCount: number;
  lastActivityAt: string;
  coverImageUrl: string | null;
};

export type Session = {
  id: string;
  projectId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GenerationSummary = Omit<
  GenerationView,
  'projectId' | 'jobs' | 'images'
> & {
  jobs: Array<{
    id: string;
    provider: ProviderId;
    model: string;
    status: GenerationStatus;
    error: JobView['error'] | null;
  }>;
  images: Array<Omit<ImageView, 'index' | 'favorited'>>;
};

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

export type AppSettingsView = {
  settings: {
    imageRetentionDays: number | null;
  };
  localData: {
    mediaBytes: number;
    databaseBytes: number;
    logBytes: number;
    totalBytes: number;
  };
  webCapabilities: {
    managesDownloadLocation: boolean;
    canOpenDataDirectory: boolean;
  };
  app: {
    version: string;
    license: string;
  };
};

export type HistoryGroup = {
  session: Session;
  generationCount: number;
  imageCount: number;
  lastGenerationAt: string;
  items: GenerationSummary[];
  nextCursor: string | null;
};

export type HistoryPage = {
  projectId: string;
  page: number;
  pageSize: number;
  totalSessions: number;
  totalPages: number;
  totals: {
    generations: number;
    images: number;
  };
  groups: HistoryGroup[];
};

export type GalleryItem = {
  favoriteId: string;
  imageId: string;
  url: string | null;
  availability: ImageAvailability;
  removedAt: string | null;
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

export type CredentialSource = 'env' | 'user-config' | 'none';

export type ProviderConfiguration = {
  providerId: ProviderId;
  displayName: string;
  credentialName: string;
  configured: boolean;
  source: CredentialSource;
  models: ProviderCapabilities[];
  enabledModelCount: number;
  availableModelCount: number;
  editable: boolean;
  keyApplyUrl: string;
  credentialStorageMode: 'encrypted-file' | 'session-memory';
};
