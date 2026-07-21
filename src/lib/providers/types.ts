import type { ProviderDiagnostic } from './error-diagnostics';

export type { ProviderDiagnostic, ProviderDiagnosticCategory } from './error-diagnostics';

/** Long enough to respect provider back-pressure without persisting raw headers. */
export const MAX_PROVIDER_RETRY_AFTER_MS = 15 * 60_000;

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

/**
 * Whether a provider submit can be safely attempted again.
 *
 * This is intentionally separate from `retryable`: a request that may be
 * transiently failing can still have reached a billable provider endpoint.
 */
export type ProviderRequestDisposition =
  | 'not_started'
  | 'rejected'
  | 'unknown';

export type ProviderError = {
  code: ProviderErrorCode;
  message: string;
  retryable: boolean;
  httpStatus?: number;
  disposition?: ProviderRequestDisposition;
  /** A bounded, parsed provider Retry-After value. It is never persisted raw. */
  retryAfterMs?: number;
  /**
   * Allowlisted provider metadata for safe support diagnostics. Raw upstream
   * messages, response bodies, prompt fragments, URLs, and credentials are
   * intentionally excluded from this shape.
   */
  diagnostic?: ProviderDiagnostic;
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
