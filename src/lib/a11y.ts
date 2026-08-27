const DEFAULT_ACCESSIBLE_EXCERPT_LENGTH = 160;

/** Keeps user-authored text useful in accessible names without announcing
 * an entire multi-thousand-character prompt for every image control. */
export function accessibleExcerpt(
  value: string,
  maximumLength = DEFAULT_ACCESSIBLE_EXCERPT_LENGTH,
): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length <= maximumLength) return normalized;
  return normalized.slice(0, Math.max(1, maximumLength - 1)).trimEnd() + '…';
}
