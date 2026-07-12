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
  const provider = getById(params.provider);
  if (!provider) {
    throw new ValidationError('Provider not enabled');
  }

  const capabilities = provider.capabilities.get(params.model);
  if (!capabilities) {
    throw new ValidationError(`Model not found: ${params.model}`);
  }

  const mode = params.mode ?? 'text-to-image';
  if (!capabilities.modes.includes(mode)) {
    throw new ValidationError(`Mode ${mode} not supported by ${params.model}`);
  }

  const count = params.count ?? 1;
  if (count > capabilities.maxCount) {
    throw new ValidationError(
      `Count ${count} exceeds max ${capabilities.maxCount}`,
    );
  }

  if (capabilities.protocol === 'sync' && count > 1) {
    throw new ValidationError('Sync provider supports count=1 only in MVP');
  }

  if (params.seed !== undefined && !capabilities.supportsSeed) {
    throw new ValidationError('Seed not supported by this provider/model');
  }

  if (params.negativePrompt && !capabilities.supportsNegativePrompt) {
    throw new ValidationError(
      'Negative prompt not supported by this provider/model',
    );
  }

  if (params.width !== undefined || params.height !== undefined) {
    if (params.width === undefined || params.height === undefined) {
      throw new ValidationError(
        'Both width and height are required when specifying size',
      );
    }
    const size = `${params.width}x${params.height}`;
    if (
      capabilities.supportedSizes.length > 0 &&
      !capabilities.supportedSizes.includes(size)
    ) {
      throw new ValidationError(`Unsupported size: ${size}`);
    }
  } else if (
    params.aspectRatio &&
    capabilities.supportedAspectRatios.length > 0 &&
    !capabilities.supportedAspectRatios.includes(params.aspectRatio)
  ) {
    throw new ValidationError(
      `Unsupported aspect ratio: ${params.aspectRatio}`,
    );
  }

  if (params.sessionId && !sessionExists(params.sessionId, ctx.db)) {
    throw new ValidationError('Session not found');
  }
}
