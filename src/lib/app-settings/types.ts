export const APP_SETTINGS_VERSION = 1 as const;
export const MAX_IMAGE_RETENTION_DAYS = 36_500;

export type AppSettings = Readonly<{
  /** null means that automatic media cleanup is disabled. */
  imageRetentionDays: number | null;
}>;

export type StoredAppSettings = Readonly<{
  version: typeof APP_SETTINGS_VERSION;
  imageRetentionDays?: number | null;
}>;

export type LocalDataSummary = Readonly<{
  mediaBytes: number;
  databaseBytes: number;
  logBytes: number;
  totalBytes: number;
}>;
