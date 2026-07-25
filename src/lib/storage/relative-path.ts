import path from 'node:path';

export function toPortableStoragePath(relativePath: string): string {
  return relativePath.replaceAll('\\', '/');
}

export function resolveStorageRelativePath(root: string, storagePath: string): string | null {
  const normalized = toPortableStoragePath(storagePath);
  if (
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(storagePath) ||
    normalized.startsWith('//') ||
    normalized.includes(':') ||
    normalized.split('/').some((segment) => segment === '..')
  ) return null;

  const absolutePath = path.resolve(root, ...normalized.split('/'));
  const relativeToRoot = path.relative(root, absolutePath);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) return null;
  return absolutePath;
}
