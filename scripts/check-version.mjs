import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const packagePath = path.join(repositoryRoot, 'package.json');
const lockPath = path.join(repositoryRoot, 'package-lock.json');
const changelogPath = path.join(repositoryRoot, 'CHANGELOG.md');

const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function fail(message) {
  console.error(`[version-check] ${message}`);
  process.exitCode = 1;
}

function firstReleasedVersion(changelog) {
  for (const match of changelog.matchAll(/^## \[([^\]]+)](?:\s+-\s+\d{4}-\d{2}-\d{2})?\s*$/gm)) {
    if (match[1] !== 'Unreleased') return match[1];
  }
  return undefined;
}

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const changelog = fs.readFileSync(changelogPath, 'utf8');
const version = packageJson.version;

if (typeof version !== 'string' || !semverPattern.test(version)) {
  fail('package.json version must be a valid SemVer version');
}
if (packageLock.version !== version || packageLock.packages?.['']?.version !== version) {
  fail('package-lock.json root version must match package.json');
}
if (firstReleasedVersion(changelog) !== version) {
  fail('the latest released version in CHANGELOG.md must match package.json');
}

if (process.exitCode !== 1) {
  console.log(`[version-check] v${version} is consistent across package metadata and CHANGELOG.md`);
}
