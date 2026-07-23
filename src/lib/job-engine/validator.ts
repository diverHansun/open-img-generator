import { ValidationError } from '../errors';
import { sessionExists, type DbClient } from '../db';
import { getById } from '../providers';
import type { SubmitGenerationParams } from './types';
import { normalizeClientRequestId } from './idempotency';

export type ValidationContext = {
  db: DbClient;
};

// This bounds our own request handling and durable snapshots. Exact prompt
// limits remain a provider concern because they differ by model and change
// independently from this service.
export const MAX_PROMPT_LENGTH = 16_000;

export function validate(
  params: SubmitGenerationParams,
  ctx: ValidationContext,
): void {
  if (!params || typeof params !== 'object') {
    throw new ValidationError('Request body must be an object');
  }
  normalizeClientRequestId(params.clientRequestId);
  if (typeof params.prompt !== 'string' || params.prompt.trim().length === 0) {
    throw new ValidationError('Prompt is required');
  }
  if (params.prompt.length > MAX_PROMPT_LENGTH) {
    throw new ValidationError('Prompt exceeds the maximum allowed length');
  }
  if (!Array.isArray(params.targets) || params.targets.length === 0) {
    throw new ValidationError('At least one target is required');
  }
  const count = params.count ?? 1;
  if (!Number.isInteger(count) || count < 1) {
    throw new ValidationError('Count must be a positive integer');
  }
  if (params.seed != null && !Number.isInteger(params.seed)) {
    throw new ValidationError('Seed must be an integer');
  }
  const hasWidth = params.width != null;
  const hasHeight = params.height != null;
  if (hasWidth !== hasHeight) {
    throw new ValidationError('Width and height must be provided together');
  }
  if (
    (hasWidth && !Number.isInteger(params.width)) ||
    (hasHeight && !Number.isInteger(params.height)) ||
    (hasWidth && (params.width! <= 0 || params.height! <= 0))
  ) {
    throw new ValidationError('Width and height must be positive integers');
  }
  if (params.negativePrompt != null && typeof params.negativePrompt !== 'string') {
    throw new ValidationError('Negative prompt must be a string');
  }
  if (
    params.referenceImages != null &&
    (!Array.isArray(params.referenceImages) ||
      params.referenceImages.some((value) => typeof value !== 'string' || value.trim().length === 0))
  ) {
    throw new ValidationError('Reference images must be non-empty strings');
  }
  if (params.mode === 'image-to-image' && (!params.referenceImages || params.referenceImages.length === 0)) {
    throw new ValidationError('Image-to-image mode requires at least one reference image');
  }
  const seenTargets = new Set<string>();
  let requestedMediaKind: 'image' | 'video' | undefined;

  for (const target of params.targets) {
    if (!target || typeof target.provider !== 'string' || typeof target.model !== 'string') {
      throw new ValidationError('Each target requires provider and model');
    }
    const key = `${target.provider}:${target.model}`;
    if (seenTargets.has(key)) {
      throw new ValidationError(`Duplicate target: ${key}`);
    }
    seenTargets.add(key);

    const provider = getById(target.provider);
    if (!provider) {
      throw new ValidationError(`Provider not enabled: ${target.provider}`);
    }
    const capabilities = provider.capabilities.get(target.model);
    if (!capabilities) {
      throw new ValidationError(`Model not found: ${target.model}`);
    }
    const mode = params.mode ?? 'text-to-image';
    const mediaKind = capabilities.mediaKind ?? 'image';
    if (requestedMediaKind && requestedMediaKind !== mediaKind) {
      throw new ValidationError('Image and video targets cannot be mixed');
    }
    requestedMediaKind = mediaKind;
    if (!capabilities.modes.includes(mode)) {
      throw new ValidationError(`Mode ${mode} not supported by ${target.model}`);
    }
    if (count > capabilities.maxCount) {
      throw new ValidationError(`Count ${count} exceeds max ${capabilities.maxCount}`);
    }
    if (
      params.aspectRatio &&
      !capabilities.supportedAspectRatios.includes(params.aspectRatio)
    ) {
      throw new ValidationError(`Unsupported aspect ratio: ${params.aspectRatio}`);
    }
    if (params.negativePrompt && !capabilities.supportsNegativePrompt) {
      throw new ValidationError('Negative prompt not supported by every selected target');
    }
    if (params.seed != null && !capabilities.supportsSeed) {
      throw new ValidationError('Seed not supported by every selected target');
    }
  }

  if (typeof params.sessionId !== 'string' || params.sessionId.length === 0) {
    throw new ValidationError('Session is required');
  }
  if (!sessionExists(params.sessionId, ctx.db)) {
    throw new ValidationError('Session not found');
  }
}
