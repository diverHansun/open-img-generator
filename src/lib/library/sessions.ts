import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import {
  db,
  projects,
  sessions,
  type DbClient,
  type Session,
} from '../db';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { getProject } from './projects';

function normalizeTitle(title: unknown): string | null {
  if (title === undefined || title === null) return null;
  if (typeof title !== 'string') {
    throw new ValidationError('Session title must be a string');
  }
  return title.trim() || null;
}

export function createSession(
  input: { projectId: string; title?: unknown },
  client: DbClient = db,
): Session {
  getProject(input.projectId, client);
  const now = new Date().toISOString();
  const id = randomUUID();
  try {
    client.transaction((tx) => {
      tx.insert(sessions)
        .values({
          id,
          projectId: input.projectId,
          title: normalizeTitle(input.title),
          createdAt: now,
          updatedAt: now,
        })
        .run();
      tx.update(projects)
        .set({ updatedAt: now })
        .where(eq(projects.id, input.projectId))
        .run();
    });
  } catch (err) {
    if (err instanceof Error && /foreign key|constraint/i.test(err.message)) {
      throw new ConflictError('Project was deleted before the Session was created');
    }
    throw err;
  }
  return getSession(id, client);
}

export function listSessions(
  projectId: string,
  client: DbClient = db,
): Session[] {
  getProject(projectId, client);
  return client
    .select()
    .from(sessions)
    .where(eq(sessions.projectId, projectId))
    .orderBy(desc(sessions.updatedAt), desc(sessions.id))
    .all();
}

export function getSession(id: string, client: DbClient = db): Session {
  const session = client.select().from(sessions).where(eq(sessions.id, id)).get();
  if (!session) throw new NotFoundError(`Session not found: ${id}`);
  return session;
}

export function updateSession(
  id: string,
  input: { title: unknown },
  client: DbClient = db,
): Session {
  getSession(id, client);
  if (typeof input.title !== 'string') {
    throw new ValidationError('Session title must be a string');
  }
  client
    .update(sessions)
    .set({ title: normalizeTitle(input.title), updatedAt: new Date().toISOString() })
    .where(eq(sessions.id, id))
    .run();
  return getSession(id, client);
}

export function moveSession(
  id: string,
  input: { toProjectId: unknown },
  client: DbClient = db,
): Session {
  if (typeof input.toProjectId !== 'string' || input.toProjectId.length === 0) {
    throw new ValidationError('toProjectId is required');
  }
  const source = getSession(id, client);
  getProject(input.toProjectId, client);
  const now = new Date().toISOString();
  client.transaction((tx) => {
    tx.update(sessions)
      .set({ projectId: input.toProjectId as string, updatedAt: now })
      .where(eq(sessions.id, id))
      .run();
    tx.update(projects)
      .set({ updatedAt: now })
      .where(eq(projects.id, source.projectId))
      .run();
    tx.update(projects)
      .set({ updatedAt: now })
      .where(eq(projects.id, input.toProjectId as string))
      .run();
  });
  return getSession(id, client);
}
