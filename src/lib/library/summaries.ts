import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  db,
  generationJobs,
  generations,
  images,
  projects,
  sessions,
  type DbClient,
} from '../db';
import type { ProjectSummary } from './types';

type ProjectCounts = {
  count: number;
  latestAt: string | null;
};

function numberValue(value: number | string): number {
  return Number(value);
}

function latestTimestamp(...timestamps: Array<string | null | undefined>): string {
  return timestamps.reduce<string>((latest, timestamp) => {
    if (!timestamp || timestamp <= latest) return latest;
    return timestamp;
  }, timestamps.find((timestamp): timestamp is string => Boolean(timestamp)) ?? new Date(0).toISOString());
}

/**
 * Returns workspace cards without client-side N+1 calls. The few aggregate
 * queries are bounded by the complete project set rather than per project.
 */
export function listProjectSummaries(
  client: DbClient = db,
): ProjectSummary[] {
  const projectRows = client.select().from(projects).all();
  if (projectRows.length === 0) return [];

  const projectIds = projectRows.map((project) => project.id);
  const sessionCounts = new Map<string, ProjectCounts>(
    client
      .select({
        projectId: sessions.projectId,
        count: sql<number>`count(*)`,
        latestAt: sql<string | null>`max(${sessions.updatedAt})`,
      })
      .from(sessions)
      .where(inArray(sessions.projectId, projectIds))
      .groupBy(sessions.projectId)
      .all()
      .map((row) => [
        row.projectId,
        { count: numberValue(row.count), latestAt: row.latestAt },
      ]),
  );

  const generationCounts = new Map<string, ProjectCounts>(
    client
      .select({
        projectId: sessions.projectId,
        count: sql<number>`count(*)`,
        latestAt: sql<string | null>`max(${generations.updatedAt})`,
      })
      .from(generations)
      .innerJoin(sessions, eq(generations.sessionId, sessions.id))
      .where(inArray(sessions.projectId, projectIds))
      .groupBy(sessions.projectId)
      .all()
      .map((row) => [
        row.projectId,
        { count: numberValue(row.count), latestAt: row.latestAt },
      ]),
  );

  const imageCounts = new Map<string, ProjectCounts>(
    client
      .select({
        projectId: sessions.projectId,
        count: sql<number>`count(*)`,
        latestAt: sql<string | null>`max(${images.createdAt})`,
      })
      .from(images)
      .innerJoin(generationJobs, eq(images.generationJobId, generationJobs.id))
      .innerJoin(generations, eq(generationJobs.generationId, generations.id))
      .innerJoin(sessions, eq(generations.sessionId, sessions.id))
      .where(inArray(sessions.projectId, projectIds))
      .groupBy(sessions.projectId)
      .all()
      .map((row) => [
        row.projectId,
        { count: numberValue(row.count), latestAt: row.latestAt },
      ]),
  );

  const coverImageByProject = new Map<string, string>();
  const imageRows = client
    .select({
      projectId: sessions.projectId,
      imageId: images.id,
    })
    .from(images)
    .innerJoin(generationJobs, eq(images.generationJobId, generationJobs.id))
    .innerJoin(generations, eq(generationJobs.generationId, generations.id))
    .innerJoin(sessions, eq(generations.sessionId, sessions.id))
    .where(
      and(
        inArray(sessions.projectId, projectIds),
        isNotNull(images.storagePath),
      ),
    )
    .orderBy(desc(images.createdAt), desc(images.id))
    .all();
  for (const image of imageRows) {
    if (!coverImageByProject.has(image.projectId)) {
      coverImageByProject.set(image.projectId, image.imageId);
    }
  }

  return projectRows
    .map((project) => {
      const session = sessionCounts.get(project.id);
      const generation = generationCounts.get(project.id);
      const image = imageCounts.get(project.id);
      return {
        project,
        sessionCount: session?.count ?? 0,
        generationCount: generation?.count ?? 0,
        imageCount: image?.count ?? 0,
        lastActivityAt: latestTimestamp(
          project.updatedAt,
          session?.latestAt,
          generation?.latestAt,
          image?.latestAt,
        ),
        coverImageUrl: coverImageByProject.has(project.id)
          ? `/api/images/${coverImageByProject.get(project.id)}`
          : null,
      };
    })
    .sort(
      (left, right) =>
        right.lastActivityAt.localeCompare(left.lastActivityAt) ||
        right.project.id.localeCompare(left.project.id),
    );
}
