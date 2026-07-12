export type ProviderId =
  | 'fal'
  | 'zenmux'
  | 'siliconflow'
  | 'zhipu'
  | 'doubao'
  | 'qwen'
  | 'kling';

export type ProviderMode = 'text-to-image' | 'image-to-image';

export type NormalizedRequest = {
  prompt: string;
  mode?: ProviderMode;
  width?: number;
  height?: number;
  aspectRatio?: string;
  count?: number;
  negativePrompt?: string;
  seed?: number;
  referenceImages?: string[];
  providerOptions?: Record<string, unknown>;
};

export type ProviderImageRef = {
  url: string;
  width: number | null;
  height: number | null;
  contentType: string;
  index: number;
  revisedPrompt?: string;
};

export type JobHandle = {
  providerId: ProviderId;
  model: string;
  externalId: string;
  statusUrl: string;
  responseUrl: string;
  cancelUrl: string | null;
  submittedAt: string;
};

export type ProviderErrorCode =
  | 'AUTH_FAILED'
  | 'QUOTA_EXCEEDED'
  | 'INVALID_REQUEST'
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'TIMEOUT'
  | 'UNKNOWN';

export type ProviderError = {
  code: ProviderErrorCode;
  message: string;
  retryable: boolean;
  httpStatus?: number;
};

export type SubmitResult =
  | { kind: 'sync'; images: ProviderImageRef[] }
  | { kind: 'async'; handle: JobHandle }
  | { kind: 'failed'; error: ProviderError };

export type PollResult =
  | { status: 'pending' }
  | { status: 'running' }
  | { status: 'completed'; images: ProviderImageRef[] }
  | { status: 'failed'; error: ProviderError }
  | { status: 'cancelled' };

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

export interface ImageProvider {
  id: ProviderId;
  displayName: string;
  capabilities: Map<string, ProviderCapabilities>;
  submit(req: NormalizedRequest, model: string): Promise<SubmitResult>;
  poll?(handle: JobHandle): Promise<PollResult>;
  cancel?(handle: JobHandle): Promise<PollResult>;
}
