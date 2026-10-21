import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, notExists } from 'drizzle-orm';
import {
  db,
  generationJobs,
  generations,
  images,
  projects,
  sessions,
  videos,
  type DbClient,
  type Session,
} from '../db';
import { removeStoredFile } from '../storage';
import {
  ConflictError,
  InitialSessionUnavailableError,
  NotFoundError,
  ValidationError,
} from '../errors';
import { getProject } from './projects';

function normalizeTitle(title: unknown): string | null {
  if (title === undefined || title === null) return null;
  if (typeof title !== 'string') {
    throw new ValidationError('Session title must be a string');
  }
  return title.trim() || null;
}

/**
 * A project holds at most one empty, untitled session. Asking for another
 * untitled session reuses it (and folds away any older empty duplicates);
 * naming a session or generating into it is what makes it permanent.
 */
export function createSession(
  input: { projectId: string; title?: unknown },
  client: DbClient = db,
): Session {
  getProject(input.projectId, client);
  const title = normalizeTitle(input.title);
  const now = new Date().toISOString();
  const id = randomUUID();
  let reusedId: string | null = null;
  try {
    client.transaction((tx) => {
      if (title === null) {
        const drafts = tx
          .select({ id: sessions.id })
          .from(sessions)
          .where(
            and(
              eq(sessions.projectId, input.projectId),
              isNull(sessions.title),
              notExists(
                tx
                  .select({ id: generations.id })
                  .from(generations)
                  .where(eq(generations.sessionId, sessions.id)),
              ),
            ),
          )
          .orderBy(desc(sessions.updatedAt), desc(sessions.id))
          .all();
        const [keep, ...extra] = drafts;
        if (keep) {
          if (extra.length > 0) {
            tx.delete(sessions)
              .where(inArray(sessions.id, extra.map((draft) => draft.id)))
              .run();
          }
          tx.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, keep.id)).run();
          reusedId = keep.id;
          return;
        }
      }
      tx.insert(sessions)
        .values({
          id,
          projectId: input.projectId,
          title,
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
  return getSession(reusedId ?? id, client);
}

/**
 * Reuses the current session for a project or creates exactly one first session.
 * The transaction keeps this operation atomic for the single-process SQLite MVP;
 * callers must use this instead of a client-side list-then-create race.
 */
export function ensureInitialSession(
  projectId: string,
  client: DbClient = db,
): { session: Session; created: boolean } {
  const now = new Date().toISOString();
  const id = randomUUID();

  try {
    return client.transaction((tx) => {
      getProject(projectId, tx);
      const existing = tx
        .select()
        .from(sessions)
        .where(eq(sessions.projectId, projectId))
        .orderBy(desc(sessions.updatedAt), desc(sessions.id))
        .get();
      if (existing) return { session: existing, created: false };

      const created: Session = {
        id,
        projectId,
        title: `session-${id.slice(0, 8)}`,
        createdAt: now,
        updatedAt: now,
      };
      tx.insert(sessions).values(created).run();
      tx.update(projects)
        .set({ updatedAt: now })
        .where(eq(projects.id, projectId))
        .run();
      return { session: created, created: true };
    });
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ConflictError) throw err;
    throw new InitialSessionUnavailableError(
      'Unable to prepare the initial Session. Please retry.',
    );
  }
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

export type DeletedSession = {
  id: string;
  projectId: string;
  generationCount: number;
  imageCount: number;
};

/**
 * Deletes a session with every generation, image, video and favorite in it.
 * Refused while any job is still pending or running, so the worker never
 * writes into a generation that no longer exists.
 */
export function deleteSession(id: string, client: DbClient = db): DeletedSession {
  const now = new Date().toISOString();
  const { result, storagePaths } = client.transaction((tx) => {
    const session = getSession(id, tx);
    const generationIds = tx
      .select({ id: generations.id })
      .from(generations)
      .where(eq(generations.sessionId, id))
      .all()
      .map((row) => row.id);
    const paths: string[] = [];
    let imageCount = 0;
    if (generationIds.length > 0) {
      const active = tx
        .select({ id: generationJobs.id })
        .from(generationJobs)
        .where(
          and(
            inArray(generationJobs.generationId, generationIds),
            inArray(generationJobs.status, ['pending', 'running']),
          ),
        )
        .get();
      if (active) {
        throw new ConflictError('Session has generations in progress');
      }
      const jobIds = tx
        .select({ id: generationJobs.id })
        .from(generationJobs)
        .where(inArray(generationJobs.generationId, generationIds))
        .all()
        .map((row) => row.id);
      if (jobIds.length > 0) {
        const imageRows = tx
          .select({ storagePath: images.storagePath })
          .from(images)
          .where(inArray(images.generationJobId, jobIds))
          .all();
        imageCount = imageRows.length;
        const videoRows = tx
          .select({ storagePath: videos.storagePath })
          .from(videos)
          .where(inArray(videos.generationJobId, jobIds))
          .all();
        for (const row of [...imageRows, ...videoRows]) {
          if (row.storagePath) paths.push(row.storagePath);
        }
      }
      // Jobs, images, videos and favorites cascade from generations.
      tx.delete(generations).where(eq(generations.sessionId, id)).run();
    }
    tx.delete(sessions).where(eq(sessions.id, id)).run();
    tx.update(projects)
      .set({ updatedAt: now })
      .where(eq(projects.id, session.projectId))
      .run();
    return {
      result: {
        id,
        projectId: session.projectId,
        generationCount: generationIds.length,
        imageCount,
      },
      storagePaths: paths,
    };
  });
  for (const storagePath of storagePaths) {
    try {
      removeStoredFile(storagePath);
    } catch {
      // The rows are gone; orphan cleanup can retry stray bytes later.
    }
  }
  return result;
}
