import fs from 'node:fs';
import path from 'node:path';
import { getRuntimePaths } from '../runtime-paths';
import { rotateLogFileIfNeeded } from './log-rotation';

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_ROTATIONS = 3;

export type LocalLogSinkOptions = {
  directory?: string;
  maxBytes?: number;
  rotations?: number;
};

export function getLocalLogDirectory(options: LocalLogSinkOptions = {}): string {
  return options.directory === undefined
    ? getRuntimePaths().logDirectory
    : path.resolve(options.directory);
}

/**
 * Best-effort bounded JSONL sink. It deliberately never logs its own failures:
 * the caller already emitted to stderr and recursive logging could amplify a
 * full-disk incident.
 */
export function appendLocalLogLine(
  line: string,
  options: LocalLogSinkOptions = {},
): boolean {
  if (process.env.APP_FILE_LOG_ENABLED === '0') return false;
  if (
    process.env.NODE_ENV === 'test' &&
    options.directory === undefined &&
    process.env.APP_LOG_DIR === undefined
  ) return false;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const rotations = options.rotations ?? DEFAULT_ROTATIONS;
  const directory = getLocalLogDirectory(options);
  const file = path.join(directory, 'app.jsonl');
  const bytes = Buffer.byteLength(line + '\n');
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    rotateLogFileIfNeeded(file, bytes, { maxBytes, rotations });
    fs.appendFileSync(file, line + '\n', { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}
