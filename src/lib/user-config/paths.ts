import os from 'node:os';
import path from 'node:path';

export function getUserConfigDirectory(): string {
  return path.resolve(
    process.env.USER_CONFIG_DIR ??
      path.join(os.homedir(), '.config', 'open-image-generator'),
  );
}

export function getCredentialsFilePath(): string {
  return path.join(getUserConfigDirectory(), 'credentials.enc.json');
}
