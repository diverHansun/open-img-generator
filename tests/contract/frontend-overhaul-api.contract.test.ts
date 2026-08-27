import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConfigurationUnavailableError,
  CredentialManagedByEnvironmentError,
  ValidationError,
} from '../../src/lib/errors';
import { GET as getProjectSummaries } from '../../src/app/api/project-summaries/route';
import { GET as getHistory } from '../../src/app/api/projects/[id]/history/route';
import { POST as postInitialSession } from '../../src/app/api/projects/[id]/sessions/initial/route';
import { GET as getProviderConfigurations } from '../../src/app/api/provider-configurations/route';
import {
  DELETE as deleteProviderCredential,
  PUT as putProviderCredential,
} from '../../src/app/api/provider-configurations/[providerId]/credential/route';
import type { ProviderConfiguration } from '../../src/lib/provider-config';

vi.mock('../../src/lib/library', () => ({
  listProjectSummaries: vi.fn(),
  getProjectHistory: vi.fn(),
  ensureInitialSession: vi.fn(),
}));

vi.mock('../../src/lib/provider-config', () => ({
  listProviderConfigurations: vi.fn(),
  setProviderCredential: vi.fn(),
  removeProviderCredential: vi.fn(),
}));

import * as library from '../../src/lib/library';
import * as providerConfig from '../../src/lib/provider-config';

const session = {
  id: 'session-1',
  projectId: 'project-1',
  title: 'session-session-',
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
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
  credentialStorageMode: 'encrypted-file',
};

describe('frontend-overhaul API contracts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns project summaries as a no-store read model', async () => {
    vi.mocked(library.listProjectSummaries).mockReturnValue([
      {
        project: { id: 'project-1', title: 'Demo', createdAt: 'now', updatedAt: 'now' },
        sessionCount: 1,
        generationCount: 2,
        imageCount: 3,
        lastActivityAt: 'now',
        coverImageUrl: '/api/images/image-1',
      },
    ]);

    const response = getProjectSummaries();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({ coverImageUrl: '/api/images/image-1' }),
    ]);
  });

  it('makes initial Session creation idempotent at the HTTP boundary', async () => {
    vi.mocked(library.ensureInitialSession)
      .mockReturnValueOnce({ session, created: true })
      .mockReturnValueOnce({ session, created: false });

    const created = await postInitialSession(
      new Request('http://localhost:3000/api/projects/project-1/sessions/initial', { method: 'POST' }),
      { params: Promise.resolve({ id: 'project-1' }) },
    );
    const reused = await postInitialSession(
      new Request('http://localhost:3000/api/projects/project-1/sessions/initial', { method: 'POST' }),
      { params: Promise.resolve({ id: 'project-1' }) },
    );

    expect(created.status).toBe(201);
    expect(reused.status).toBe(200);
    expect(library.ensureInitialSession).toHaveBeenCalledWith('project-1', expect.anything());
  });

  it('delegates the History aggregate to a read-only library query with bounded params', async () => {
    vi.mocked(library.getProjectHistory).mockReturnValue({
      projectId: 'project-1',
      page: 1,
      pageSize: 5,
      totalSessions: 0,
      totalPages: 0,
      totals: { generations: 0, images: 0 },
      groups: [],
    });

    const response = await getHistory(
      new Request('http://localhost:3000/api/projects/project-1/history?page=1&sessionLimit=5&generationLimit=10'),
      { params: Promise.resolve({ id: 'project-1' }) },
    );

    expect(response.status).toBe(200);
    expect(library.getProjectHistory).toHaveBeenCalledWith(
      {
        projectId: 'project-1',
        page: 1,
        sessionLimit: 5,
        generationLimit: 10,
      },
      expect.anything(),
    );
  });

  it('returns structured errors for invalid History reads', async () => {
    vi.mocked(library.getProjectHistory).mockImplementation(() => {
      throw new ValidationError('page must be an integer between 1 and 9007199254740991');
    });

    const response = await getHistory(
      new Request('http://localhost:3000/api/projects/project-1/history?page=0'),
      { params: Promise.resolve({ id: 'project-1' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'page must be an integer between 1 and 9007199254740991',
        retryable: false,
      },
    });
  });

  it('uses a secret-free Provider configuration summary and an explicit env conflict', async () => {
    vi.mocked(providerConfig.listProviderConfigurations).mockReturnValue([configuration]);
    vi.mocked(providerConfig.setProviderCredential).mockRejectedValue(
      new CredentialManagedByEnvironmentError('This credential is managed by the environment and cannot be changed here.'),
    );

    const listResponse = getProviderConfigurations();
    const putResponse = await putProviderCredential(
      jsonRequest('/api/provider-configurations/fal/credential', { value: 'secret-canary' }, 'PUT'),
      { params: Promise.resolve({ providerId: 'fal' }) },
    );

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual([configuration]);
    expect(putResponse.status).toBe(409);
    await expect(putResponse.json()).resolves.toEqual({
      error: {
        code: 'CREDENTIAL_MANAGED_BY_ENV',
        message: 'This credential is managed by the environment and cannot be changed here.',
        retryable: false,
      },
    });

    vi.mocked(providerConfig.removeProviderCredential).mockRejectedValue(
      new CredentialManagedByEnvironmentError('This credential is managed by the environment and cannot be changed here.'),
    );
    const deleteResponse = await deleteProviderCredential(
      new Request('http://localhost:3000/api/provider-configurations/fal/credential', { method: 'DELETE' }),
      { params: Promise.resolve({ providerId: 'fal' }) },
    );
    expect(deleteResponse.status).toBe(409);
    await expect(deleteResponse.json()).resolves.toEqual({
      error: {
        code: 'CREDENTIAL_MANAGED_BY_ENV',
        message: 'This credential is managed by the environment and cannot be changed here.',
        retryable: false,
      },
    });
  });

  it('turns unavailable encrypted storage into a secret-free 503 configuration error', async () => {
    const canary = 'secret-e2e-canary-corrupted-store';
    vi.mocked(providerConfig.listProviderConfigurations).mockImplementation(() => {
      throw new ConfigurationUnavailableError(
        'Encrypted credential storage is unavailable. Check USER_CONFIG_ENCRYPTION_KEY.',
      );
    });

    const response = getProviderConfigurations();

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: 'CONFIGURATION_UNAVAILABLE',
        message: 'Encrypted credential storage is unavailable. Check USER_CONFIG_ENCRYPTION_KEY.',
        retryable: false,
      },
    });
    expect(JSON.stringify(body)).not.toContain(canary);
  });

  it('returns a secret-free summary after PUT and DELETE', async () => {
    vi.mocked(providerConfig.setProviderCredential).mockResolvedValue(configuration);
    vi.mocked(providerConfig.removeProviderCredential).mockResolvedValue(configuration);

    const putResponse = await putProviderCredential(
      jsonRequest('/api/provider-configurations/fal/credential', { value: 'secret-canary' }, 'PUT'),
      { params: Promise.resolve({ providerId: 'fal' }) },
    );
    const deleteResponse = await deleteProviderCredential(
      new Request('http://localhost:3000/api/provider-configurations/fal/credential', { method: 'DELETE' }),
      { params: Promise.resolve({ providerId: 'fal' }) },
    );

    expect(JSON.stringify(await putResponse.json())).not.toContain('secret-canary');
    expect(JSON.stringify(await deleteResponse.json())).not.toContain('secret-canary');
  });
});

function jsonRequest(pathname: string, body: unknown, method: 'PUT') {
  return new Request(`http://localhost:3000${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
