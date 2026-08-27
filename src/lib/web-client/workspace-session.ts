import type { ApiClient } from './api-client';
import type { Session } from './types';

export type WorkspaceSessionResult = {
  session: Session;
  sessions: Session[];
  source: 'existing' | 'initial';
};

/**
 * Finds the current Session or calls the server-side idempotent ensure route.
 * It never falls back to the ordinary createSession endpoint.
 */
export async function loadWorkspaceSession(
  client: Pick<ApiClient, 'listSessions' | 'ensureInitialSession'>,
  projectId: string,
): Promise<WorkspaceSessionResult> {
  const sessions = await client.listSessions(projectId);
  const session = sessions[0];
  if (session) return { session, sessions, source: 'existing' };
  const initialSession = await client.ensureInitialSession(projectId);
  return {
    session: initialSession,
    sessions: [initialSession],
    source: 'initial',
  };
}
