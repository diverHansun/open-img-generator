import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { rotateLogFileIfNeeded } from './log-rotation';

describe('log rotation', () => {
  it('keeps a log file and at most the configured number of rotations', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'log-rotation-'));
    const file = path.join(directory, 'desktop.log');
    try {
      for (let index = 0; index < 8; index += 1) {
        const line = `${index} ${'x'.repeat(48)}\n`;
        rotateLogFileIfNeeded(file, Buffer.byteLength(line), {
          maxBytes: 100,
          rotations: 2,
        });
        fs.appendFileSync(file, line);
      }
      expect(fs.readdirSync(directory).sort()).toEqual([
        'desktop.log',
        'desktop.log.1',
        'desktop.log.2',
      ]);
      expect(fs.statSync(file).size).toBeLessThanOrEqual(100);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not rotate a missing or empty file', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'log-rotation-'));
    const file = path.join(directory, 'desktop.log');
    try {
      rotateLogFileIfNeeded(file, 1_000, { maxBytes: 10, rotations: 2 });
      expect(fs.readdirSync(directory)).toEqual([]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
