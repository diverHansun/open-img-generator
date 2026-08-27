import type { Locale } from './index';

const relativeUnits = [
  { unit: 'year', milliseconds: 365 * 24 * 60 * 60 * 1_000 },
  { unit: 'month', milliseconds: 30 * 24 * 60 * 60 * 1_000 },
  { unit: 'week', milliseconds: 7 * 24 * 60 * 60 * 1_000 },
  { unit: 'day', milliseconds: 24 * 60 * 60 * 1_000 },
  { unit: 'hour', milliseconds: 60 * 60 * 1_000 },
  { unit: 'minute', milliseconds: 60 * 1_000 },
] as const;

function toTimestamp(value: string | number | Date): number | null {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function formatRelativeTime(
  value: string | number | Date,
  locale: Locale,
  now = Date.now(),
): string {
  const timestamp = toTimestamp(value);
  if (timestamp === null) return '';
  const difference = timestamp - now;
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const match = relativeUnits.find(
    ({ milliseconds }) => Math.abs(difference) >= milliseconds,
  );
  if (!match) return formatter.format(0, 'minute');
  return formatter.format(
    Math.round(difference / match.milliseconds),
    match.unit,
  );
}

export function formatDateTime(
  value: string | number | Date,
  locale: Locale,
): string {
  const timestamp = toTimestamp(value);
  if (timestamp === null) return '';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
}
