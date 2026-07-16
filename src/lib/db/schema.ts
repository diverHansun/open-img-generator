import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  title: text('title'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const generations = sqliteTable('generations', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => sessions.id),
  prompt: text('prompt').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const generationJobs = sqliteTable('generation_jobs', {
  id: text('id').primaryKey(),
  generationId: text('generation_id')
    .notNull()
    .references(() => generations.id),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  status: text('status').notNull(),
  providerHandle: text('provider_handle'),
  error: text('error'),
  pollLeaseUntil: text('poll_lease_until'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const images = sqliteTable(
  'images',
  {
    id: text('id').primaryKey(),
    generationJobId: text('generation_job_id')
      .notNull()
      .references(() => generationJobs.id),
    index: integer('index').notNull(),
    storagePath: text('storage_path').notNull(),
    contentType: text('content_type').notNull(),
    width: integer('width'),
    height: integer('height'),
    sizeBytes: integer('size_bytes'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    uniqueJobIndex: uniqueIndex('unique_job_index').on(
      table.generationJobId,
      table.index,
    ),
  }),
);

export type Session = typeof sessions.$inferSelect;
export type Generation = typeof generations.$inferSelect;
export type GenerationJob = typeof generationJobs.$inferSelect;
export type Image = typeof images.$inferSelect;
