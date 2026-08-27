import { ApiClientError, type ApiClient } from './api-client';

export type AuthGateState =
  | { state: 'authenticated' }
  | { state: 'unauthenticated' }
  | { state: 'unavailable'; error: ApiClientError | Error };

/**
 * Browser pages call this before protected data reads. It deliberately does
 * not alter page middleware or expose an auth token to application code.
 */
export async function resolveAuthGate(
  client: Pick<ApiClient, 'getAuthSession'>,
): Promise<AuthGateState> {
  try {
    const session = await client.getAuthSession();
    return session.authenticated
      ? { state: 'authenticated' }
      : { state: 'unauthenticated' };
  } catch (error) {
    return {
      state: 'unavailable',
      error: error instanceof Error ? error : new Error('Authentication check failed'),
    };
  }
}
