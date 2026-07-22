import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_ROTATIONS = 3;

export type LocalLogSinkOptions = {
  directory?: string;
  maxBytes?: number;
  rotations?: number;
};

export function getLocalLogDirectory(options: LocalLogSinkOptions = {}): string {
  return path.resolve(options.directory ?? process.env.APP_LOG_DIR ?? './data/logs');
}

function rotate(file: string, rotations: number): void {
  for (let index = rotations; index >= 1; index -= 1) {
    const source = index === 1 ? file : `${file}.${index - 1}`;
    const target = `${file}.${index}`;
    if (!fs.existsSync(source)) continue;
    fs.rmSync(target, { force: true });
    fs.renameSync(source, target);
  }
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
    const currentBytes = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (currentBytes > 0 && currentBytes + bytes > maxBytes) {
      rotate(file, rotations);
    }
    fs.appendFileSync(file, line + '\n', { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}
