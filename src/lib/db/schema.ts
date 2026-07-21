import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    updatedAtIndex: index('projects_updated_at_idx').on(table.updatedAt),
  }),
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    title: text('title'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    projectUpdatedAtIndex: index('sessions_project_updated_at_idx').on(
      table.projectId,
      table.updatedAt,
    ),
  }),
);

export const generations = sqliteTable(
  'generations',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    prompt: text('prompt').notNull(),
    status: text('status').notNull(),
    mediaKind: text('media_kind').notNull().default('image'),
    clientRequestId: text('client_request_id'),
    requestHash: text('request_hash'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    sessionCreatedAtIndex: index('generations_session_created_at_idx').on(
      table.sessionId,
      table.createdAt,
    ),
    createdAtIndex: index('generations_created_at_idx').on(table.createdAt),
    clientRequestIdUnique: uniqueIndex(
      'generations_client_request_id_unique',
    )
      .on(table.clientRequestId)
      .where(sql`${table.clientRequestId} IS NOT NULL`),
  }),
);

export const generationJobs = sqliteTable(
  'generation_jobs',
  {
    id: text('id').primaryKey(),
    generationId: text('generation_id')
      .notNull()
      .references(() => generations.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    status: text('status').notNull(),
    providerHandle: text('provider_handle'),
    error: text('error'),
    /** Internal recoverable lifecycle; public status remains the five user states. */
    phase: text('phase').notNull().default('queued'),
    /** Validated, versioned NormalizedRequest; never exposed through API DTOs. */
    requestSnapshot: text('request_snapshot'),
    requestSnapshotVersion: integer('request_snapshot_version'),
    /** Short-lived remote image references while the job is being stored. */
    resultSnapshot: text('result_snapshot'),
    attemptCount: integer('attempt_count').notNull().default(0),
    retryStartedAt: text('retry_started_at'),
    pollLeaseUntil: text('poll_lease_until'),
    nextPollAt: text('next_poll_at'),
    cancelRequestedAt: text('cancel_requested_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    generationIndex: index('generation_jobs_generation_idx').on(
      table.generationId,
    ),
    dueIndex: index('generation_jobs_due_idx').on(
      table.phase,
      table.nextPollAt,
      table.pollLeaseUntil,
      table.updatedAt,
      table.id,
    ),
  }),
);

export const images = sqliteTable(
  'images',
  {
    id: text('id').primaryKey(),
    generationJobId: text('generation_job_id')
      .notNull()
      .references(() => generationJobs.id, { onDelete: 'cascade' }),
    index: integer('index').notNull(),
    storagePath: text('storage_path'),
    contentType: text('content_type').notNull(),
    width: integer('width'),
    height: integer('height'),
    sizeBytes: integer('size_bytes'),
    createdAt: text('created_at').notNull(),
    removedAt: text('removed_at'),
    removalReason: text('removal_reason'),
  },
  (table) => ({
    uniqueJobIndex: uniqueIndex('unique_job_index').on(
      table.generationJobId,
      table.index,
    ),
    availabilityInvariant: check(
      'images_availability_check',
      sql`(
        (${table.storagePath} IS NOT NULL AND ${table.removedAt} IS NULL AND ${table.removalReason} IS NULL)
        OR
        (${table.storagePath} IS NULL AND ${table.removedAt} IS NOT NULL AND ${table.removalReason} IN ('retention_expired', 'user_deleted', 'storage_missing'))
      )`,
    ),
  }),
);

export const videos = sqliteTable(
  'videos',
  {
    id: text('id').primaryKey(),
    generationJobId: text('generation_job_id')
      .notNull()
      .references(() => generationJobs.id, { onDelete: 'cascade' }),
    index: integer('index').notNull(),
    storagePath: text('storage_path'),
    contentType: text('content_type').notNull(),
    width: integer('width'),
    height: integer('height'),
    durationSeconds: integer('duration_seconds'),
    sizeBytes: integer('size_bytes'),
    createdAt: text('created_at').notNull(),
    removedAt: text('removed_at'),
    removalReason: text('removal_reason'),
  },
  (table) => ({
    uniqueJobIndex: uniqueIndex('unique_video_job_index').on(
      table.generationJobId,
      table.index,
    ),
  }),
);

export const favorites = sqliteTable(
  'favorites',
  {
    id: text('id').primaryKey(),
    imageId: text('image_id')
      .notNull()
      .references(() => images.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    imageUnique: uniqueIndex('favorites_image_unique').on(table.imageId),
    createdAtIndex: index('favorites_created_at_idx').on(table.createdAt),
  }),
);

export const modelPreferences = sqliteTable(
  'model_preferences',
  {
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.provider, table.model] }),
  }),
);

export type Project = typeof projects.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Generation = typeof generations.$inferSelect;
export type GenerationJob = typeof generationJobs.$inferSelect;
export type Image = typeof images.$inferSelect;
export type Video = typeof videos.$inferSelect;
export type Favorite = typeof favorites.$inferSelect;
export type ModelPreference = typeof modelPreferences.$inferSelect;
