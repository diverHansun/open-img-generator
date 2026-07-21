import {
  and,
  desc,
  eq,
  inArray,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  db,
  generationJobs,
  generations,
  images,
  getImageAvailability,
  sessionExists,
  sessions,
  type DbClient,
  type Generation,
  type GenerationJob,
  type GenerationStatus,
  type Image,
} from '../db';
import { toSafeJobError } from '../job-engine/job-error';
import { getProject } from './projects';
import { NotFoundError, ValidationError } from '../errors';
import type { GenerationSummary, HistoryPage, Page } from './types';

type Cursor = { createdAt: string; id: string };
type GenerationSummaryRow = Pick<
  Generation,
  'id' | 'sessionId' | 'prompt' | 'status' | 'createdAt' | 'updatedAt'
>;

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

function parseError(error: string | null): GenerationSummary['jobs'][number]['error'] {
  return toSafeJobError(error) ?? null;
}

function appendToMap<T>(map: Map<string, T[]>, key: string, value: T): void {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}

function toSummaries(
  generationRows: GenerationSummaryRow[],
  client: DbClient,
): GenerationSummary[] {
  if (generationRows.length === 0) return [];

  const generationIds = generationRows.map((generation) => generation.id);
  const jobRows = client
    .select()
    .from(generationJobs)
    .where(inArray(generationJobs.generationId, generationIds))
    .all();
  const jobIds = jobRows.map((job) => job.id);
  const imageRows =
    jobIds.length > 0
      ? client
          .select()
          .from(images)
          .where(inArray(images.generationJobId, jobIds))
          .all()
      : [];

  const jobsByGeneration = new Map<string, GenerationJob[]>();
  const generationByJob = new Map<string, string>();
  for (const job of jobRows) {
    appendToMap(jobsByGeneration, job.generationId, job);
    generationByJob.set(job.id, job.generationId);
  }

  const imagesByGeneration = new Map<string, Image[]>();
  for (const image of imageRows) {
    const generationId = generationByJob.get(image.generationJobId);
    if (generationId) appendToMap(imagesByGeneration, generationId, image);
  }

  return generationRows.map((generation) => ({
    id: generation.id,
    sessionId: generation.sessionId,
    prompt: generation.prompt,
    status: generation.status as GenerationStatus,
    createdAt: generation.createdAt,
    updatedAt: generation.updatedAt,
    jobs: (jobsByGeneration.get(generation.id) ?? []).map((job) => ({
      id: job.id,
      provider: job.provider,
      model: job.model,
      status: job.status as GenerationStatus,
      error: parseError(job.error),
    })),
    images: (imagesByGeneration.get(generation.id) ?? []).map((image) => {
      const availability = getImageAvailability(image);
      return {
        id: image.id,
        jobId: image.generationJobId,
        url: availability === 'available' ? `/api/images/${image.id}` : null,
        width: image.width,
        height: image.height,
        availability,
        removedAt: image.removedAt,
      };
    }),
  }));
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

  let rows: GenerationSummaryRow[];
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
    items: toSummaries(pageRows, client),
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

  const totalsRow = client
    .select({
      totalSessions: sql<number>`count(distinct ${sessions.id})`,
      generations: sql<number>`count(distinct ${generations.id})`,
      images: sql<number>`count(${images.id})`,
    })
    .from(sessions)
    .innerJoin(generations, eq(generations.sessionId, sessions.id))
    .leftJoin(generationJobs, eq(generationJobs.generationId, generations.id))
    .leftJoin(images, eq(images.generationJobId, generationJobs.id))
    .where(eq(sessions.projectId, input.projectId))
    .get();
  const totalSessions = Number(totalsRow?.totalSessions ?? 0);
  const totalPages = Math.ceil(totalSessions / sessionLimit);
  const start = (page - 1) * sessionLimit;

  const pageGroups = client
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
    .limit(sessionLimit)
    .offset(start)
    .all()
    .map((group) => ({
      ...group,
      generationCount: Number(group.generationCount),
      imageCount: Number(group.imageCount),
    }));

  const sessionIds = pageGroups.map((group) => group.session.id);
  let generationRows: GenerationSummaryRow[] = [];
  if (sessionIds.length > 0) {
    const rankedGenerations = client
      .select({
        id: generations.id,
        sessionId: generations.sessionId,
        prompt: generations.prompt,
        status: generations.status,
        createdAt: generations.createdAt,
        updatedAt: generations.updatedAt,
        rowNumber:
          sql<number>`row_number() over (partition by ${generations.sessionId} order by ${generations.createdAt} desc, ${generations.id} desc)`.as(
            'row_number',
          ),
      })
      .from(generations)
      .where(inArray(generations.sessionId, sessionIds))
      .as('ranked_generations');

    generationRows = client
      .select({
        id: rankedGenerations.id,
        sessionId: rankedGenerations.sessionId,
        prompt: rankedGenerations.prompt,
        status: rankedGenerations.status,
        createdAt: rankedGenerations.createdAt,
        updatedAt: rankedGenerations.updatedAt,
      })
      .from(rankedGenerations)
      .where(lte(rankedGenerations.rowNumber, generationLimit + 1))
      .orderBy(
        desc(rankedGenerations.createdAt),
        desc(rankedGenerations.id),
      )
      .all();
  }

  const generationsBySession = new Map<string, GenerationSummaryRow[]>();
  for (const generation of generationRows) {
    appendToMap(generationsBySession, generation.sessionId, generation);
  }

  const visibleGenerationsBySession = new Map<string, GenerationSummaryRow[]>();
  const visibleGenerationRows: GenerationSummaryRow[] = [];
  for (const group of pageGroups) {
    const visible = (generationsBySession.get(group.session.id) ?? []).slice(
      0,
      generationLimit,
    );
    visibleGenerationsBySession.set(group.session.id, visible);
    visibleGenerationRows.push(...visible);
  }
  const summariesById = new Map(
    toSummaries(visibleGenerationRows, client).map((summary) => [
      summary.id,
      summary,
    ]),
  );

  return {
    projectId: input.projectId,
    page,
    pageSize: sessionLimit,
    totalSessions,
    totalPages,
    totals: {
      generations: Number(totalsRow?.generations ?? 0),
      images: Number(totalsRow?.images ?? 0),
    },
    groups: pageGroups.map((group) => {
      const allRows = generationsBySession.get(group.session.id) ?? [];
      const visibleRows = visibleGenerationsBySession.get(group.session.id) ?? [];
      const last = visibleRows.at(-1);
      return {
        session: group.session,
        generationCount: group.generationCount,
        imageCount: group.imageCount,
        lastGenerationAt: group.lastGenerationAt,
        items: visibleRows.map((generation) => summariesById.get(generation.id)!),
        nextCursor:
          allRows.length > generationLimit && last
            ? encodeCursor({ createdAt: last.createdAt, id: last.id })
            : null,
      };
    }),
  };
}
