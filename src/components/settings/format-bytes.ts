const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Formats an application-owned byte count; it never measures system storage. */
export function formatBytes(value: number, locale: string): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  let current = value;
  let unit = 0;
  while (current >= 1_024 && unit < BYTE_UNITS.length - 1) {
    current /= 1_024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(current)} ${BYTE_UNITS[unit]}`;
}
