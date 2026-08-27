import type { ApiClient } from './api-client';
import type { ProviderConfiguration } from './types';

export type CredentialDraftResult =
  | { kind: 'saved'; configuration: ProviderConfiguration }
  | { kind: 'cleared'; configuration: ProviderConfiguration }
  | {
      kind: 'validation-error';
      code: 'CREDENTIAL_VALUE_REQUIRED' | 'CREDENTIAL_MANAGED_BY_ENV';
      message: string;
    };

/**
 * Maps the later Provider form's local draft to the secure credential API.
 * An empty draft only clears a user-configured value; it never transmits a
 * blank write and never attempts to modify an environment-owned credential.
 */
export async function saveProviderCredentialDraft(
  client: Pick<
    ApiClient,
    'saveProviderCredential' | 'removeProviderCredential'
  >,
  configuration: ProviderConfiguration,
  draft: string,
): Promise<CredentialDraftResult> {
  if (!configuration.editable) {
    return {
      kind: 'validation-error',
      code: 'CREDENTIAL_MANAGED_BY_ENV',
      message: 'This API key is managed by the environment.',
    };
  }
  const value = draft.trim();
  if (!value) {
    if (configuration.source !== 'user-config') {
      return {
        kind: 'validation-error',
        code: 'CREDENTIAL_VALUE_REQUIRED',
        message: 'Please enter an API key.',
      };
    }
    return {
      kind: 'cleared',
      configuration: await client.removeProviderCredential(
        configuration.providerId,
      ),
    };
  }
  return {
    kind: 'saved',
    configuration: await client.saveProviderCredential(
      configuration.providerId,
      value,
    ),
  };
}
