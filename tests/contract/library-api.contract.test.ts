import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as postProject } from '../../src/app/api/projects/route';
import { POST as postProjectSession } from '../../src/app/api/projects/[id]/sessions/route';
import { POST as postFavorite } from '../../src/app/api/favorites/route';
import { PUT as putPreference } from '../../src/app/api/model-preferences/route';

vi.mock('../../src/lib/library', () => ({
  createProject: vi.fn(),
  listProjects: vi.fn(),
  createSession: vi.fn(),
  listSessions: vi.fn(),
  addFavorite: vi.fn(),
  listFavorites: vi.fn(),
  listModelPreferences: vi.fn(),
  upsertModelPreference: vi.fn(),
}));

import * as library from '../../src/lib/library';

describe('library API contracts', () => {
  beforeEach(() => vi.resetAllMocks());

  it('creates a project and then a session scoped to it', async () => {
    vi.mocked(library.createProject).mockReturnValue({
      id: 'project-1', title: 'Demo',
      createdAt: '2026-07-16T00:00:00.000Z', updatedAt: '2026-07-16T00:00:00.000Z',
    });
    vi.mocked(library.createSession).mockReturnValue({
      id: 'session-1', projectId: 'project-1', title: null,
      createdAt: '2026-07-16T00:00:00.000Z', updatedAt: '2026-07-16T00:00:00.000Z',
    });

    const projectResponse = await postProject(jsonRequest('/api/projects', { title: 'Demo' }));
    const sessionResponse = await postProjectSession(
      jsonRequest('/api/projects/project-1/sessions', {}),
      { params: Promise.resolve({ id: 'project-1' }) },
    );

    expect(projectResponse.status).toBe(201);
    expect(sessionResponse.status).toBe(201);
    expect(library.createSession).toHaveBeenCalledWith(
      { projectId: 'project-1', title: undefined },
      expect.anything(),
    );
  });

  it('returns an idempotent favorite as 200', async () => {
    vi.mocked(library.addFavorite).mockReturnValue({
      favoriteId: 'favorite-1', imageId: 'image-1', url: '/api/images/image-1',
      width: 1024, height: 1024, favoritedAt: '2026-07-16T00:00:00.000Z',
      jobId: 'job-1', provider: 'fal', model: 'fal-ai/flux/schnell',
      generationId: 'generation-1', prompt: 'A cat', sessionId: 'session-1',
      projectId: 'project-1', projectTitle: 'Demo',
    });

    const response = await postFavorite(
      jsonRequest('/api/favorites', { imageId: 'image-1' }),
    );
    expect(response.status).toBe(200);
    expect(library.addFavorite).toHaveBeenCalledWith('image-1', expect.anything());
  });

  it('passes a single model preference upsert through unchanged', async () => {
    vi.mocked(library.upsertModelPreference).mockReturnValue({
      provider: 'fal', model: 'fal-ai/flux/schnell', enabled: false,
      updatedAt: '2026-07-16T00:00:00.000Z',
    });
    const body = { provider: 'fal', model: 'fal-ai/flux/schnell', enabled: false };
    const response = await putPreference(jsonRequest('/api/model-preferences', body));

    expect(response.status).toBe(200);
    expect(library.upsertModelPreference).toHaveBeenCalledWith(body, expect.anything());
  });
});

function jsonRequest(pathname: string, body: unknown) {
  return new Request(`http://localhost:3000${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
