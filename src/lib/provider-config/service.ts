import {
  CredentialManagedByEnvironmentError,
  ConfigurationUnavailableError,
  NotFoundError,
  ValidationError,
} from '../errors';
import type { DbClient } from '../db';
import { db } from '../db';
import { listModelPreferences } from '../library/model-prefs';
import {
  clearCredentialCache,
  readEncryptedCredentials,
  writeCredentials,
  type ProviderCredentialName,
  type StoredCredentials,
} from '../user-config';
import type { ProviderCapabilities, ProviderId } from '../providers';
import { getProviderCatalogEntry, providerCatalog } from './catalog';

export type CredentialSource = 'env' | 'user-config' | 'none';

export type ProviderConfiguration = {
  providerId: ProviderId;
  displayName: string;
  credentialName: ProviderCredentialName;
  configured: boolean;
  source: CredentialSource;
  models: ProviderCapabilities[];
  enabledModelCount: number;
  availableModelCount: number;
  editable: boolean;
  keyApplyUrl: string;
};

let credentialWriteTail: Promise<void> = Promise.resolve();

function readStoredCredentials(): StoredCredentials {
  try {
    return readEncryptedCredentials();
  } catch {
    throw new ConfigurationUnavailableError(
      'Encrypted credential storage is unavailable. Check USER_CONFIG_ENCRYPTION_KEY.',
    );
  }
}

function sourceFor(
  credentialName: ProviderCredentialName,
  credentials: StoredCredentials,
): CredentialSource {
  if (process.env[credentialName]) return 'env';
  return credentials[credentialName] ? 'user-config' : 'none';
}

function toConfiguration(
  providerId: ProviderId,
  credentials: StoredCredentials,
  preferences: ReadonlyMap<string, boolean>,
): ProviderConfiguration {
  const entry = getProviderCatalogEntry(providerId)!;
  const source = sourceFor(entry.credentialName, credentials);
  const enabledModelCount = entry.models.filter(
    (model) => preferences.get(`${model.providerId}:${model.model}`) !== false,
  ).length;
  return {
    providerId: entry.providerId,
    displayName: entry.displayName,
    credentialName: entry.credentialName,
    configured: source !== 'none',
    source,
    models: entry.models,
    enabledModelCount,
    availableModelCount: entry.models.length,
    editable: source !== 'env',
    keyApplyUrl: entry.keyApplyUrl,
  };
}

function getPreferenceMap(client: DbClient): Map<string, boolean> {
  return new Map(
    listModelPreferences(client).map((preference) => [
      `${preference.provider}:${preference.model}`,
      preference.enabled,
    ]),
  );
}

function requireEntry(providerId: string) {
  const entry = getProviderCatalogEntry(providerId);
  if (!entry) throw new NotFoundError('Provider not found');
  return entry;
}

function queueCredentialWrite<T>(operation: () => T): Promise<T> {
  const result = credentialWriteTail.then(operation);
  credentialWriteTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function writeStoredCredentials(credentials: StoredCredentials): void {
  try {
    writeCredentials(credentials);
  } catch {
    throw new ConfigurationUnavailableError(
      'Encrypted credential storage is unavailable. Check USER_CONFIG_ENCRYPTION_KEY.',
    );
  }
}

export function listProviderConfigurations(
  client: DbClient = db,
): ProviderConfiguration[] {
  const credentials = readStoredCredentials();
  const preferences = getPreferenceMap(client);
  return providerCatalog.map((entry) =>
    toConfiguration(entry.providerId, credentials, preferences),
  );
}

export function getProviderConfiguration(
  providerId: string,
  client: DbClient = db,
): ProviderConfiguration {
  requireEntry(providerId);
  const credentials = readStoredCredentials();
  return toConfiguration(
    providerId as ProviderId,
    credentials,
    getPreferenceMap(client),
  );
}

export function setProviderCredential(
  providerId: string,
  value: unknown,
  client: DbClient = db,
): Promise<ProviderConfiguration> {
  return queueCredentialWrite(() => {
    const entry = requireEntry(providerId);
    if (typeof value !== 'string') {
      throw new ValidationError('Credential value must be a string');
    }
    const normalized = value.trim();
    if (normalized.length === 0 || normalized.length > 16 * 1024) {
      throw new ValidationError('Credential value must be between 1 and 16384 characters');
    }
    const credentials = readStoredCredentials();
    if (sourceFor(entry.credentialName, credentials) === 'env') {
      throw new CredentialManagedByEnvironmentError(
        'This credential is managed by the environment and cannot be changed here.',
      );
    }
    writeStoredCredentials({ ...credentials, [entry.credentialName]: normalized });
    return getProviderConfiguration(entry.providerId, client);
  });
}

export function removeProviderCredential(
  providerId: string,
  client: DbClient = db,
): Promise<ProviderConfiguration> {
  return queueCredentialWrite(() => {
    const entry = requireEntry(providerId);
    const credentials = readStoredCredentials();
    if (sourceFor(entry.credentialName, credentials) === 'env') {
      throw new CredentialManagedByEnvironmentError(
        'This credential is managed by the environment and cannot be changed here.',
      );
    }
    if (!credentials[entry.credentialName]) {
      return toConfiguration(
        entry.providerId,
        credentials,
        getPreferenceMap(client),
      );
    }
    const nextCredentials = { ...credentials };
    delete nextCredentials[entry.credentialName];
    writeStoredCredentials(nextCredentials);
    return getProviderConfiguration(entry.providerId, client);
  });
}

/** Test-only convenience for process-wide credential cache isolation. */
export function resetProviderConfigurationState(): void {
  credentialWriteTail = Promise.resolve();
  clearCredentialCache();
}
