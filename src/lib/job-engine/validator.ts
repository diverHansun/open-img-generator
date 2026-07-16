import { ValidationError } from '../errors';
import { sessionExists, type DbClient } from '../db';
import { getById } from '../providers';
import type { SubmitGenerationParams } from './types';

export type ValidationContext = {
  db: DbClient;
};

export function validate(
  params: SubmitGenerationParams,
  ctx: ValidationContext,
): void {
  if (!params || typeof params !== 'object') {
    throw new ValidationError('Request body must be an object');
  }
  if (typeof params.prompt !== 'string' || params.prompt.trim().length === 0) {
    throw new ValidationError('Prompt is required');
  }
  if (!Array.isArray(params.targets) || params.targets.length === 0) {
    throw new ValidationError('At least one target is required');
  }
  const count = params.count ?? 1;
  if (!Number.isInteger(count) || count < 1) {
    throw new ValidationError('Count must be a positive integer');
  }
  if (params.seed !== undefined && !Number.isInteger(params.seed)) {
    throw new ValidationError('Seed must be an integer');
  }
  if (params.negativePrompt !== undefined && typeof params.negativePrompt !== 'string') {
    throw new ValidationError('Negative prompt must be a string');
  }
  const seenTargets = new Set<string>();

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
    if (!capabilities.modes.includes(mode)) {
      throw new ValidationError(`Mode ${mode} not supported by ${target.model}`);
    }
    if (count > capabilities.maxCount) {
      throw new ValidationError(`Count ${count} exceeds max ${capabilities.maxCount}`);
    }
    if (capabilities.protocol === 'sync' && count > 1) {
      throw new ValidationError('Sync provider supports count=1 only in MVP');
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
  }

  if (params.sessionId && !sessionExists(params.sessionId, ctx.db)) {
    throw new ValidationError('Session not found');
  }
}
