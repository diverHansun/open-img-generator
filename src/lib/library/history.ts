import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import {
  db,
  fetchGenerationDetails,
  generations,
  sessions,
  type DbClient,
  type Generation,
  type GenerationStatus,
} from '../db';
import { ValidationError } from '../errors';
import type { GenerationSummary, Page } from './types';

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
