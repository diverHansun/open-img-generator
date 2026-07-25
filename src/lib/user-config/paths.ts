import path from 'node:path';
import { getRuntimePaths } from '../runtime-paths';

export function getUserConfigDirectory(): string {
  return getRuntimePaths().userConfigDirectory;
}

export function getCredentialsFilePath(): string {
  return path.join(getUserConfigDirectory(), 'credentials.enc.json');
}
