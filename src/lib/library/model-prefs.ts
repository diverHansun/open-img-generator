import { and, desc, eq } from 'drizzle-orm';
import {
  db,
  modelPreferences,
  type DbClient,
  type ModelPreference,
} from '../db';
import { ValidationError } from '../errors';
import { getById } from '../providers';
import type { ProviderId } from '../providers/types';

export function listModelPreferences(
  client: DbClient = db,
): ModelPreference[] {
  return client
    .select()
    .from(modelPreferences)
    .orderBy(desc(modelPreferences.updatedAt))
    .all();
}

export function upsertModelPreference(
  input: { provider: unknown; model: unknown; enabled: unknown },
  client: DbClient = db,
): ModelPreference {
  if (
    typeof input.provider !== 'string' ||
    typeof input.model !== 'string' ||
    typeof input.enabled !== 'boolean'
  ) {
    throw new ValidationError('provider, model and enabled are required');
  }
  const provider = getById(input.provider as ProviderId);
  if (!provider?.capabilities.has(input.model)) {
    throw new ValidationError('Model preference must reference an enabled model');
  }
  const now = new Date().toISOString();
  client
    .insert(modelPreferences)
    .values({
      provider: input.provider,
      model: input.model,
      enabled: input.enabled,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [modelPreferences.provider, modelPreferences.model],
      set: { enabled: input.enabled, updatedAt: now },
    })
    .run();
  return client
    .select()
    .from(modelPreferences)
    .where(
      andPreference(input.provider, input.model),
    )
    .get()!;
}

function andPreference(provider: string, model: string) {
  return and(
    eq(modelPreferences.provider, provider),
    eq(modelPreferences.model, model),
  );
}
