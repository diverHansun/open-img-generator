import { randomUUID } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import {
  db,
  projects,
  sessions,
  type DbClient,
  type Project,
} from '../db';
import { ConflictError, NotFoundError, ValidationError } from '../errors';

function requireTitle(title: unknown): string {
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new ValidationError('Project title is required');
  }
  return title.trim();
}

export function createProject(
  input: { title: unknown },
  client: DbClient = db,
): Project {
  const now = new Date().toISOString();
  const id = randomUUID();
  client
    .insert(projects)
    .values({ id, title: requireTitle(input.title), createdAt: now, updatedAt: now })
    .run();
  return getProject(id, client);
}

export function listProjects(client: DbClient = db): Project[] {
  return client
    .select()
    .from(projects)
    .orderBy(desc(projects.updatedAt), desc(projects.id))
    .all();
}

export function getProject(id: string, client: DbClient = db): Project {
  const project = client.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) throw new NotFoundError(`Project not found: ${id}`);
  return project;
}

export function updateProject(
  id: string,
  input: { title: unknown },
  client: DbClient = db,
): Project {
  getProject(id, client);
  client
    .update(projects)
    .set({ title: requireTitle(input.title), updatedAt: new Date().toISOString() })
    .where(eq(projects.id, id))
    .run();
  return getProject(id, client);
}

export function deleteProject(id: string, client: DbClient = db): void {
  getProject(id, client);
  const childCount = client
    .select({ count: sql<number>`count(*)` })
    .from(sessions)
    .where(eq(sessions.projectId, id))
    .get()!.count;
  if (childCount > 0) {
    throw new ConflictError('Project must be empty before deletion');
  }
  client.delete(projects).where(eq(projects.id, id)).run();
}
