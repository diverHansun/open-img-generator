import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

type StoredDesktopPreferences = {
  version: 1;
  downloadDirectory?: string;
};

export const DESKTOP_PREFERENCES_FILE = 'desktop-preferences.json';

export function resolveAvailableDownloadPath(
  downloadDirectory: string,
  requestedFileName: string,
): string {
  const candidateName = path.basename(requestedFileName).trim();
  const safeName =
    candidateName && candidateName !== '.' && candidateName !== '..'
      ? candidateName
      : 'download';
  const directPath = path.join(downloadDirectory, safeName);
  if (!fs.existsSync(directPath)) return directPath;

  const parsed = path.parse(safeName);
  for (let suffix = 1; suffix <= 9_999; suffix += 1) {
    const candidatePath = path.join(
      downloadDirectory,
      `${parsed.name} (${suffix})${parsed.ext}`,
    );
    if (!fs.existsSync(candidatePath)) return candidatePath;
  }
  return path.join(
    downloadDirectory,
    `${parsed.name}-${crypto.randomUUID()}${parsed.ext}`,
  );
}

export function getDesktopPreferencesFilePath(configDirectory: string): string {
  return path.join(configDirectory, DESKTOP_PREFERENCES_FILE);
}

export function readDownloadDirectory(
  configDirectory: string,
): string | undefined {
  const filePath = getDesktopPreferencesFilePath(configDirectory);
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<StoredDesktopPreferences>;
    return value.version === 1 &&
      typeof value.downloadDirectory === 'string' &&
      path.isAbsolute(value.downloadDirectory)
      ? path.normalize(value.downloadDirectory)
      : undefined;
  } catch {
    return undefined;
  }
}

export function writeDownloadDirectory(
  configDirectory: string,
  downloadDirectory: string | undefined,
): void {
  if (downloadDirectory !== undefined && !path.isAbsolute(downloadDirectory)) {
    throw new Error('Download directory must be absolute');
  }
  const normalized: StoredDesktopPreferences = {
    version: 1,
    ...(downloadDirectory
      ? { downloadDirectory: path.normalize(downloadDirectory) }
      : {}),
  };
  fs.mkdirSync(configDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(configDirectory, 0o700);
  const filePath = getDesktopPreferencesFilePath(configDirectory);
  const temporaryPath = path.join(
    configDirectory,
    `.desktop-preferences.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(normalized)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the primary write error.
    }
  }
}
