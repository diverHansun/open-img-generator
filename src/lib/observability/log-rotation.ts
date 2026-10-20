import fs from 'node:fs';

// Dependency-free so both the Next runtime and the Electron main process can
// bound their log files the same way.
export function rotateLogFile(file: string, rotations: number): void {
  for (let index = rotations; index >= 1; index -= 1) {
    const source = index === 1 ? file : `${file}.${index - 1}`;
    const target = `${file}.${index}`;
    if (!fs.existsSync(source)) continue;
    fs.rmSync(target, { force: true });
    fs.renameSync(source, target);
  }
}

export function rotateLogFileIfNeeded(
  file: string,
  incomingBytes: number,
  options: { maxBytes: number; rotations: number },
): void {
  const currentBytes = fs.existsSync(file) ? fs.statSync(file).size : 0;
  if (currentBytes > 0 && currentBytes + incomingBytes > options.maxBytes) {
    rotateLogFile(file, options.rotations);
  }
}
