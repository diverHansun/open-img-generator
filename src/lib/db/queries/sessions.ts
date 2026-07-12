import { eq } from 'drizzle-orm';
import { db, type DbClient } from '../client';
import { sessions, generations } from '../schema';
import type { Session } from '../schema';
import {
  fetchGenerationDetails,
  type GenerationWithJobsAndImages,
} from './generations';

export type CreateSessionParams = {
  id: string;
  title?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpdateSessionPatch = {
  title?: string | null;
  updatedAt: string;
};

export function createSession(
  params: CreateSessionParams,
  client: DbClient = db,
): Session {
  client
    .insert(sessions)
    .values({
      id: params.id,
      title: params.title ?? null,
      createdAt: params.createdAt,
      updatedAt: params.updatedAt,
    })
    .run();
  return client
    .select()
    .from(sessions)
    .where(eq(sessions.id, params.id))
    .get()!;
}

export function updateSession(
  id: string,
  patch: UpdateSessionPatch,
  client: DbClient = db,
): Session {
  client
    .update(sessions)
    .set({
      title: patch.title,
      updatedAt: patch.updatedAt,
    })
    .where(eq(sessions.id, id))
    .run();
  return client.select().from(sessions).where(eq(sessions.id, id)).get()!;
}

export function touchSession(
  id: string,
  now: string,
  client: DbClient = db,
): void {
  client
    .update(sessions)
    .set({ updatedAt: now })
    .where(eq(sessions.id, id))
    .run();
}

export function sessionExists(id: string, client: DbClient = db): boolean {
  const row = client
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.id, id))
    .get();
  return row !== undefined;
}

export type SessionWithGenerations = Session & {
  generations: GenerationWithJobsAndImages[];
};

export function getSession(
  id: string,
  client: DbClient = db,
): SessionWithGenerations {
  const session = client
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .get();
  if (!session) {
    throw new Error(`Session not found: ${id}`);
  }
  const gens = listGenerationsBySession(id, client);
  return { ...session, generations: gens };
}

export function listGenerationsBySession(
  sessionId: string,
  client: DbClient = db,
): GenerationWithJobsAndImages[] {
  const rows = client
    .select()
    .from(generations)
    .where(eq(generations.sessionId, sessionId))
    .orderBy(generations.createdAt)
    .all();
  return rows.map((gen) => fetchGenerationDetails(gen, client));
}
