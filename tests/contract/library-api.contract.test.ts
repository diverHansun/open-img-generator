import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../../src/lib/errors';
import { POST as postProject } from '../../src/app/api/projects/route';
import {
  DELETE as deleteProject,
  GET as getProject,
} from '../../src/app/api/projects/[id]/route';
import { POST as postProjectSession } from '../../src/app/api/projects/[id]/sessions/route';
import {
  GET as getFavorites,
  POST as postFavorite,
} from '../../src/app/api/favorites/route';
import { DELETE as deleteFavorite } from '../../src/app/api/favorites/[imageId]/route';
import {
  GET as getPreferences,
  PUT as putPreference,
} from '../../src/app/api/model-preferences/route';
import { POST as moveSession } from '../../src/app/api/sessions/[id]/move/route';
import { GET as listGenerations } from '../../src/app/api/generations/route';

vi.mock('../../src/lib/library', () => ({
  createProject: vi.fn(),
  listProjects: vi.fn(),
  getProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  createSession: vi.fn(),
  listSessions: vi.fn(),
  moveSession: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  listFavorites: vi.fn(),
  listModelPreferences: vi.fn(),
  upsertModelPreference: vi.fn(),
  listGenerations: vi.fn(),
}));

import * as library from '../../src/lib/library';

const galleryItem = {
  favoriteId: 'favorite-1',
  imageId: 'image-1',
  url: '/api/images/image-1',
  width: 1024,
  height: 1024,
  favoritedAt: '2026-07-16T00:00:00.000Z',
  jobId: 'job-1',
  provider: 'fal',
  model: 'fal-ai/flux/schnell',
  generationId: 'generation-1',
  prompt: 'A cat',
  sessionId: 'session-1',
  projectId: 'project-1',
  projectTitle: 'Demo',
};

describe('library API contracts', () => {
  beforeEach(() => vi.resetAllMocks());

  it('creates a project and then a session scoped to it', async () => {
    vi.mocked(library.createProject).mockReturnValue({
      id: 'project-1',
      title: 'Demo',
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    });
    vi.mocked(library.createSession).mockReturnValue({
      id: 'session-1',
      projectId: 'project-1',
      title: null,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    });

    const projectResponse = await postProject(
      jsonRequest('/api/projects', { title: 'Demo' }),
    );
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

  it('returns 400 for a non-object JSON body', async () => {
    const response = await postProject(
      new Request('http://localhost:3000/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'null',
      }),
    );
    expect(response.status).toBe(400);
    expect(library.createProject).not.toHaveBeenCalled();
  });

  it('returns a single project by id', async () => {
    vi.mocked(library.getProject).mockReturnValue({
      id: 'project-1',
      title: 'Demo',
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    });

    const response = await getProject(
      new Request('http://localhost:3000/api/projects/project-1'),
      { params: Promise.resolve({ id: 'project-1' }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: 'project-1' });
  });

  it('returns 409 when deleting a non-empty project', async () => {
    vi.mocked(library.deleteProject).mockImplementation(() => {
      throw new ConflictError('Project must be empty before deletion');
    });

    const response = await deleteProject(
      new Request('http://localhost:3000/api/projects/project-1', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: 'project-1' }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Project must be empty before deletion',
    });
  });

  it('moves a session to another project', async () => {
    vi.mocked(library.moveSession).mockReturnValue({
      id: 'session-1',
      projectId: 'project-2',
      title: 'Draft',
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T01:00:00.000Z',
    });

    const response = await moveSession(
      jsonRequest('/api/sessions/session-1/move', { toProjectId: 'project-2' }),
      { params: Promise.resolve({ id: 'session-1' }) },
    );

    expect(response.status).toBe(200);
    expect(library.moveSession).toHaveBeenCalledWith(
      'session-1',
      { toProjectId: 'project-2' },
      expect.anything(),
    );
    await expect(response.json()).resolves.toMatchObject({
      id: 'session-1',
      projectId: 'project-2',
    });
  });

  it('returns an idempotent favorite as 200', async () => {
    vi.mocked(library.addFavorite).mockReturnValue(galleryItem);

    const response = await postFavorite(
      jsonRequest('/api/favorites', { imageId: 'image-1' }),
    );
    expect(response.status).toBe(200);
    expect(library.addFavorite).toHaveBeenCalledWith('image-1', expect.anything());
    await expect(response.json()).resolves.toMatchObject({
      favoriteId: 'favorite-1',
      generationId: 'generation-1',
      projectId: 'project-1',
    });
  });

  it('lists favorites with cursor paging params', async () => {
    vi.mocked(library.listFavorites).mockReturnValue({
      items: [galleryItem],
      nextCursor: 'cursor-1',
    });

    const response = getFavorites(
      new Request(
        'http://localhost:3000/api/favorites?limit=48&cursor=cursor-0',
      ),
    );

    expect(response.status).toBe(200);
    expect(library.listFavorites).toHaveBeenCalledWith(
      {
        limit: 48,
        cursor: 'cursor-0',
        projectId: undefined,
        provider: undefined,
        sort: undefined,
      },
      expect.anything(),
    );
    await expect(response.json()).resolves.toEqual({
      items: [galleryItem],
      nextCursor: 'cursor-1',
    });
  });

  it('deletes a favorite by image id with 204', async () => {
    vi.mocked(library.removeFavorite).mockReturnValue(undefined);

    const response = await deleteFavorite(
      new Request('http://localhost:3000/api/favorites/image-1', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ imageId: 'image-1' }) },
    );

    expect(response.status).toBe(204);
    expect(library.removeFavorite).toHaveBeenCalledWith(
      'image-1',
      expect.anything(),
    );
  });

  it('returns 404 when deleting a missing favorite', async () => {
    vi.mocked(library.removeFavorite).mockImplementation(() => {
      throw new NotFoundError('Favorite not found: image-missing');
    });

    const response = await deleteFavorite(
      new Request('http://localhost:3000/api/favorites/image-missing', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ imageId: 'image-missing' }) },
    );

    expect(response.status).toBe(404);
  });

  it('lists and upserts model preferences', async () => {
    vi.mocked(library.listModelPreferences).mockReturnValue([
      {
        provider: 'fal',
        model: 'fal-ai/flux/schnell',
        enabled: false,
        updatedAt: '2026-07-16T00:00:00.000Z',
      },
    ]);
    vi.mocked(library.upsertModelPreference).mockReturnValue({
      provider: 'fal',
      model: 'fal-ai/flux/schnell',
      enabled: false,
      updatedAt: '2026-07-16T00:00:00.000Z',
    });

    const listResponse = getPreferences();
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual({
      items: [
        {
          provider: 'fal',
          model: 'fal-ai/flux/schnell',
          enabled: false,
          updatedAt: '2026-07-16T00:00:00.000Z',
        },
      ],
    });

    const body = {
      provider: 'fal',
      model: 'fal-ai/flux/schnell',
      enabled: false,
    };
    const putResponse = await putPreference(
      jsonRequest('/api/model-preferences', body, 'PUT'),
    );
    expect(putResponse.status).toBe(200);
    expect(library.upsertModelPreference).toHaveBeenCalledWith(
      body,
      expect.anything(),
    );
  });
});

describe('GET /api/generations list contracts', () => {
  beforeEach(() => {
    vi.mocked(library.listGenerations).mockReset();
  });

  it('rejects combining sessionId and projectId with 400', () => {
    vi.mocked(library.listGenerations).mockImplementation(() => {
      throw new ValidationError('sessionId and projectId cannot be combined');
    });

    const response = listGenerations(
      new Request(
        'http://localhost:3000/api/generations?sessionId=s1&projectId=p1',
      ),
    );

    expect(response.status).toBe(400);
    expect(library.listGenerations).toHaveBeenCalledWith(
      {
        sessionId: 's1',
        projectId: 'p1',
        cursor: undefined,
        limit: undefined,
      },
      expect.anything(),
    );
  });

  it('rejects an explicitly empty sessionId with 400', () => {
    vi.mocked(library.listGenerations).mockImplementation(() => {
      throw new ValidationError('sessionId must not be empty');
    });

    const response = listGenerations(
      new Request('http://localhost:3000/api/generations?sessionId='),
    );

    expect(response.status).toBe(400);
    expect(library.listGenerations).toHaveBeenCalledWith(
      {
        sessionId: '',
        projectId: undefined,
        cursor: undefined,
        limit: undefined,
      },
      expect.anything(),
    );
  });
});

function jsonRequest(
  pathname: string,
  body: unknown,
  method: 'POST' | 'PUT' = 'POST',
) {
  return new Request(`http://localhost:3000${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
