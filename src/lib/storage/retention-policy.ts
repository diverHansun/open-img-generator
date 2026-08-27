const DEFAULT_RETENTION_DAYS = 0;
const MAX_RETENTION_DAYS = 36_500;

let warnedInvalidValue: string | undefined;

export type RetentionPolicy = {
  days: number;
  enabled: boolean;
};

export function retentionPolicyFromDays(days: number | null): RetentionPolicy {
  return days === null || days === 0
    ? { days: 0, enabled: false }
    : { days, enabled: true };
}

export function parseImageRetentionDays(
  value: string | undefined = process.env.IMAGE_RETENTION_DAYS,
  warn: (message: string) => void = console.warn,
): RetentionPolicy {
  const normalized = value?.trim();
  if (normalized === undefined || normalized === '') {
    return retentionPolicyFromDays(DEFAULT_RETENTION_DAYS);
  }
  if (/^\d+$/.test(normalized)) {
    const days = Number(normalized);
    if (Number.isSafeInteger(days) && days >= 0 && days <= MAX_RETENTION_DAYS) {
      return retentionPolicyFromDays(days);
    }
  }
  if (warnedInvalidValue !== normalized) {
    warnedInvalidValue = normalized;
    warn(
      `Invalid IMAGE_RETENTION_DAYS; using ${DEFAULT_RETENTION_DAYS} days`,
    );
  }
  return retentionPolicyFromDays(DEFAULT_RETENTION_DAYS);
}

export function resetRetentionPolicyWarningForTests(): void {
  warnedInvalidValue = undefined;
}

export { DEFAULT_RETENTION_DAYS, MAX_RETENTION_DAYS };
