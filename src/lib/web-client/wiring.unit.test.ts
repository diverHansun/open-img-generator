import { describe, expect, it, vi } from 'vitest';
import { resolveAuthGate } from './auth-gate';
import { updateGalleryBrowseQuery, toFavoritesQuery } from './gallery-query';
import { saveProviderCredentialDraft } from './provider-credential';
import { LatestRequestCoordinator } from './request-state';
import { loadWorkspaceSession } from './workspace-session';
import type { ProviderConfiguration, Session } from './types';

const session: Session = {
  id: 'session-1',
  projectId: 'project-1',
  title: 'Session',
  createdAt: 'now',
  updatedAt: 'now',
};

const configuration: ProviderConfiguration = {
  providerId: 'fal',
  displayName: 'fal.ai',
  credentialName: 'FAL_KEY',
  configured: false,
  source: 'none',
  models: [],
  enabledModelCount: 0,
  availableModelCount: 0,
  editable: true,
  keyApplyUrl: 'https://fal.ai/dashboard/keys',
};

describe('frontend API wiring helpers', () => {
  it('does not issue protected page reads until the auth gate resolves', async () => {
    await expect(
      resolveAuthGate({ getAuthSession: vi.fn().mockResolvedValue({ authenticated: true }) }),
    ).resolves.toEqual({ state: 'authenticated' });
    await expect(
      resolveAuthGate({ getAuthSession: vi.fn().mockResolvedValue({ authenticated: false }) }),
    ).resolves.toEqual({ state: 'unauthenticated' });
  });

  it('uses ensureInitialSession instead of the ordinary create route', async () => {
    const client = {
      listSessions: vi.fn().mockResolvedValue([]),
      ensureInitialSession: vi.fn().mockResolvedValue(session),
    };

    await expect(loadWorkspaceSession(client, 'project-1')).resolves.toEqual({
      session,
      sessions: [session],
      source: 'initial',
    });
    expect(client.ensureInitialSession).toHaveBeenCalledWith('project-1');
  });

  it('resets Gallery cursor whenever a URL-owned filter changes', () => {
    const next = updateGalleryBrowseQuery(
      { workspace: 'project-a', provider: 'fal', cursor: 'old-cursor' },
      { provider: 'qwen' },
    );

    expect(next).toEqual({ workspace: 'project-a', provider: 'qwen' });
    expect(toFavoritesQuery(next)).toEqual({
      projectId: 'project-a',
      provider: 'qwen',
      cursor: undefined,
      sort: 'newest',
    });
  });

  it('maps only a user-configured blank credential draft to DELETE', async () => {
    const client = {
      saveProviderCredential: vi.fn().mockResolvedValue(configuration),
      removeProviderCredential: vi.fn().mockResolvedValue({
        ...configuration,
        source: 'none',
      }),
    };

    await expect(
      saveProviderCredentialDraft(
        client,
        { ...configuration, configured: true, source: 'user-config' },
        '   ',
      ),
    ).resolves.toMatchObject({ kind: 'cleared' });
    await expect(saveProviderCredentialDraft(client, configuration, '')).resolves.toEqual({
      kind: 'validation-error',
      code: 'CREDENTIAL_VALUE_REQUIRED',
      message: 'Please enter an API key.',
    });
    await expect(
      saveProviderCredentialDraft(
        client,
        { ...configuration, source: 'env', editable: false },
        'replacement',
      ),
    ).resolves.toMatchObject({
      kind: 'validation-error',
      code: 'CREDENTIAL_MANAGED_BY_ENV',
    });
    expect(client.removeProviderCredential).toHaveBeenCalledWith('fal');
    expect(client.saveProviderCredential).not.toHaveBeenCalled();
  });

  it('marks an aborted older request as stale rather than allowing it to surface', async () => {
    const coordinator = new LatestRequestCoordinator();
    let rejectFirst: ((reason?: unknown) => void) | undefined;
    const first = coordinator.run(
      (signal) =>
        new Promise<string>((_resolve, reject) => {
          rejectFirst = reject;
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const second = coordinator.run(async () => 'new value');
    rejectFirst?.(new DOMException('Aborted', 'AbortError'));

    await expect(first).resolves.toEqual({ state: 'stale' });
    await expect(second).resolves.toEqual({ state: 'current', value: 'new value' });
  });
});
