import { and, desc, eq, lt, or, sql, type SQL } from 'drizzle-orm';
import {
  db,
  fetchGenerationDetails,
  generationJobs,
  generations,
  images,
  sessionExists,
  sessions,
  type DbClient,
  type Generation,
  type GenerationStatus,
} from '../db';
import { getProject } from './projects';
import { NotFoundError, ValidationError } from '../errors';
import type { GenerationSummary, HistoryPage, Page } from './types';

type Cursor = { createdAt: string; id: string };

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(cursor: string | undefined): Cursor | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Cursor;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') {
      throw new Error('invalid cursor');
    }
    return parsed;
  } catch {
    throw new ValidationError('Invalid cursor');
  }
}

function cursorCondition(cursor: Cursor | undefined): SQL | undefined {
  if (!cursor) return undefined;
  return or(
    lt(generations.createdAt, cursor.createdAt),
    and(eq(generations.createdAt, cursor.createdAt), lt(generations.id, cursor.id)),
  );
}

function toSummary(generation: Generation, client: DbClient): GenerationSummary {
  const details = fetchGenerationDetails(generation, client);
  return {
    id: details.id,
    sessionId: details.sessionId,
    prompt: details.prompt,
    status: details.status as GenerationStatus,
    createdAt: details.createdAt,
    updatedAt: details.updatedAt,
    jobs: details.jobs.map((job) => ({
      id: job.id,
      provider: job.provider,
      model: job.model,
      status: job.status as GenerationStatus,
      error: parseError(job.error),
    })),
    images: details.images.map((image) => ({
      id: image.id,
      jobId: image.generationJobId,
      url: `/api/images/${image.id}`,
      width: image.width,
      height: image.height,
    })),
  };
}

function parseError(error: string | null): unknown | null {
  if (!error) return null;
  try {
    return JSON.parse(error) as unknown;
  } catch {
    return { code: 'UNKNOWN', message: error, retryable: false };
  }
}

export function listGenerations(
  input: {
    limit?: number;
    cursor?: string;
    sessionId?: string;
    projectId?: string;
  },
  client: DbClient = db,
): Page<GenerationSummary> {
  if (input.sessionId && input.projectId) {
    throw new ValidationError('sessionId and projectId cannot be combined');
  }
  if (
    input.limit !== undefined &&
    (!Number.isInteger(input.limit) || input.limit < 1)
  ) {
    throw new ValidationError('limit must be a positive integer');
  }
  const limit = Math.min(input.limit ?? 10, 50);
  const after = decodeCursor(input.cursor);

  if (input.projectId !== undefined && input.projectId.trim().length === 0) {
    throw new ValidationError('projectId must not be empty');
  }
  if (input.sessionId !== undefined && input.sessionId.trim().length === 0) {
    throw new ValidationError('sessionId must not be empty');
  }
  if (input.projectId) getProject(input.projectId, client);
  if (input.sessionId && !sessionExists(input.sessionId, client)) {
    throw new NotFoundError(`Session not found: ${input.sessionId}`);
  }

  const predicates: SQL[] = [];
  const afterCondition = cursorCondition(after);
  if (afterCondition) predicates.push(afterCondition);

  let rows: Generation[];
  if (input.projectId) {
    predicates.push(eq(sessions.projectId, input.projectId));
    rows = client
      .select({ generation: generations })
      .from(generations)
      .innerJoin(sessions, eq(generations.sessionId, sessions.id))
      .where(and(...predicates))
      .orderBy(desc(generations.createdAt), desc(generations.id))
      .limit(limit + 1)
      .all()
      .map((row) => row.generation);
  } else {
    if (input.sessionId) predicates.push(eq(generations.sessionId, input.sessionId));
    rows = client
      .select()
      .from(generations)
      .where(predicates.length > 0 ? and(...predicates) : undefined)
      .orderBy(desc(generations.createdAt), desc(generations.id))
      .limit(limit + 1)
      .all();
  }

  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    items: pageRows.map((generation) => toSummary(generation, client)),
    nextCursor:
      hasMore && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}

function parseBoundedInteger(
  value: number | undefined,
  name: string,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new ValidationError(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

/**
 * Groups read-only generation summaries by session for the History page.
 * It deliberately stays in the library layer and never calls the job engine,
 * so none of these reads can advance an async provider job.
 */
export function getProjectHistory(
  input: {
    projectId: string;
    page?: number;
    sessionLimit?: number;
    generationLimit?: number;
  },
  client: DbClient = db,
): HistoryPage {
  if (typeof input.projectId !== 'string' || input.projectId.trim().length === 0) {
    throw new ValidationError('projectId is required');
  }
  const page = parseBoundedInteger(input.page, 'page', 1, Number.MAX_SAFE_INTEGER);
  const sessionLimit = parseBoundedInteger(input.sessionLimit, 'sessionLimit', 5, 5);
  const generationLimit = parseBoundedInteger(
    input.generationLimit,
    'generationLimit',
    10,
    10,
  );
  getProject(input.projectId, client);

  const groups = client
    .select({
      session: sessions,
      generationCount: sql<number>`count(distinct ${generations.id})`,
      imageCount: sql<number>`count(${images.id})`,
      lastGenerationAt: sql<string>`max(${generations.createdAt})`,
    })
    .from(sessions)
    .innerJoin(generations, eq(generations.sessionId, sessions.id))
    .leftJoin(generationJobs, eq(generationJobs.generationId, generations.id))
    .leftJoin(images, eq(images.generationJobId, generationJobs.id))
    .where(eq(sessions.projectId, input.projectId))
    .groupBy(sessions.id)
    .orderBy(desc(sql`max(${generations.createdAt})`), desc(sessions.id))
    .all()
    .map((group) => ({
      ...group,
      generationCount: Number(group.generationCount),
      imageCount: Number(group.imageCount),
    }));

  const totalSessions = groups.length;
  const totalPages = Math.ceil(totalSessions / sessionLimit);
  const start = (page - 1) * sessionLimit;
  const pageGroups = groups.slice(start, start + sessionLimit);
  const totals = groups.reduce(
    (total, group) => ({
      generations: total.generations + group.generationCount,
      images: total.images + group.imageCount,
    }),
    { generations: 0, images: 0 },
  );

  return {
    projectId: input.projectId,
    page,
    pageSize: sessionLimit,
    totalSessions,
    totalPages,
    totals,
    groups: pageGroups.map((group) => {
      const generationPage = listGenerations(
        { sessionId: group.session.id, limit: generationLimit },
        client,
      );
      return {
        session: group.session,
        generationCount: group.generationCount,
        imageCount: group.imageCount,
        lastGenerationAt: group.lastGenerationAt,
        items: generationPage.items,
        nextCursor: generationPage.nextCursor,
      };
    }),
  };
}
