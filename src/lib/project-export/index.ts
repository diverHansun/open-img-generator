import fs from 'node:fs';
import path from 'node:path';

import { asc, eq, inArray } from 'drizzle-orm';
import yazl from 'yazl';

import {
  db,
  generationJobs,
  generations,
  images,
  projects,
  sessions,
  type DbClient,
  type Image,
} from '../db';
import { ConflictError, NotFoundError } from '../errors';
import { getStorageRoot } from '../storage';
import { acquireCleanupLock, verifyStorageOwnership } from '../storage/ownership';

type ExportImage = Readonly<{
  id: string;
  index: number;
  contentType: string;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  createdAt: string;
  file: string | null;
  availability: 'exported' | 'unavailable';
}>;

type ExportGeneration = Readonly<{
  id: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  jobs: ReadonlyArray<{
    id: string;
    provider: string;
    model: string;
    status: string;
  }>;
  images: ReadonlyArray<ExportImage>;
}>;

export type ProjectExportManifest = Readonly<{
  format: 'open-image-generator-project-export/v1';
  exportedAt: string;
  project: { id: string; title: string };
  sessions: ReadonlyArray<{
    id: string;
    title: string | null;
    generations: ReadonlyArray<ExportGeneration>;
  }>;
}>;

type ArchiveFile = Readonly<{
  absolutePath: string;
  archivePath: string;
}>;

export type ProjectExportArchive = Readonly<{
  filename: string;
  stream: NodeJS.ReadableStream;
}>;

function archiveSegment(value: string, fallback: string): string {
  const normalized = value
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+$/, '');
  return (normalized || fallback).slice(0, 80);
}

function archiveId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 96) || 'unknown';
}

function archiveDirectory(title: string | null, id: string, fallback: string): string {
  return `${archiveSegment(title ?? '', fallback)}--${archiveId(id)}`;
}

function extensionForImage(image: Image): string {
  const fromStoragePath = image.storagePath
    ? path.extname(image.storagePath).toLowerCase()
    : '';
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(fromStoragePath)) {
    return fromStoragePath;
  }
  const fromContentType: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
  };
  return fromContentType[image.contentType.toLowerCase()] ?? '.bin';
}

function readableStoredFile(image: Image): string | null {
  if (!image.storagePath || image.removedAt) return null;
  const root = getStorageRoot();
  const absolutePath = path.resolve(root, image.storagePath);
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  try {
    return fs.statSync(absolutePath).isFile() ? absolutePath : null;
  } catch {
    return null;
  }
}

function appendToMap<T>(map: Map<string, T[]>, key: string, value: T): void {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}

function buildSnapshot(
  projectId: string,
  client: DbClient,
): { manifest: ProjectExportManifest; files: ArchiveFile[]; root: string } {
  const project = client.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) throw new NotFoundError('Project not found');

  const sessionRows = client
    .select()
    .from(sessions)
    .where(eq(sessions.projectId, projectId))
    .orderBy(asc(sessions.createdAt), asc(sessions.id))
    .all();
  const sessionIds = sessionRows.map((session) => session.id);
  const generationRows = sessionIds.length === 0
    ? []
    : client
      .select()
      .from(generations)
      .where(inArray(generations.sessionId, sessionIds))
      .orderBy(asc(generations.createdAt), asc(generations.id))
      .all()
      .filter((generation) => generation.status === 'completed');
  const generationIds = generationRows.map((generation) => generation.id);
  const jobRows = generationIds.length === 0
    ? []
    : client
      .select()
      .from(generationJobs)
      .where(inArray(generationJobs.generationId, generationIds))
      .orderBy(asc(generationJobs.createdAt), asc(generationJobs.id))
      .all();
  const jobIds = jobRows.map((job) => job.id);
  const imageRows = jobIds.length === 0
    ? []
    : client
      .select()
      .from(images)
      .where(inArray(images.generationJobId, jobIds))
      .orderBy(asc(images.index), asc(images.id))
      .all();

  const generationsBySession = new Map<string, typeof generationRows>();
  for (const generation of generationRows) {
    appendToMap(generationsBySession, generation.sessionId, generation);
  }
  const jobsByGeneration = new Map<string, typeof jobRows>();
  const generationByJob = new Map<string, string>();
  for (const job of jobRows) {
    appendToMap(jobsByGeneration, job.generationId, job);
    generationByJob.set(job.id, job.generationId);
  }
  const imagesByGeneration = new Map<string, typeof imageRows>();
  for (const image of imageRows) {
    const generationId = generationByJob.get(image.generationJobId);
    if (generationId) appendToMap(imagesByGeneration, generationId, image);
  }

  const root = archiveDirectory(project.title, project.id, 'project');
  const files: ArchiveFile[] = [];
  const manifest: ProjectExportManifest = {
    format: 'open-image-generator-project-export/v1',
    exportedAt: new Date().toISOString(),
    project: { id: project.id, title: project.title },
    sessions: sessionRows.map((session) => {
      const sessionDirectory = archiveDirectory(session.title, session.id, 'session');
      return {
        id: session.id,
        title: session.title,
        generations: (generationsBySession.get(session.id) ?? []).map((generation) => {
          const generationDirectory = archiveDirectory(
            generation.createdAt.replace(/[:.]/g, '-'),
            generation.id,
            'generation',
          );
          const exportImages: ExportImage[] = (imagesByGeneration.get(generation.id) ?? []).map(
            (image) => {
              const absolutePath = readableStoredFile(image);
              const archivePath = absolutePath
                ? `${root}/${sessionDirectory}/${generationDirectory}/image-${String(image.index + 1).padStart(2, '0')}-${archiveId(image.id)}${extensionForImage(image)}`
                : null;
              if (absolutePath && archivePath) files.push({ absolutePath, archivePath });
              return {
                id: image.id,
                index: image.index,
                contentType: image.contentType,
                width: image.width,
                height: image.height,
                sizeBytes: image.sizeBytes,
                createdAt: image.createdAt,
                file: archivePath,
                availability: archivePath ? 'exported' : 'unavailable',
              };
            },
          );
          return {
            id: generation.id,
            prompt: generation.prompt,
            createdAt: generation.createdAt,
            updatedAt: generation.updatedAt,
            jobs: (jobsByGeneration.get(generation.id) ?? []).map((job) => ({
              id: job.id,
              provider: job.provider,
              model: job.model,
              status: job.status,
            })),
            images: exportImages,
          };
        }),
      };
    }),
  };
  return { manifest, files, root };
}

export function createProjectExportArchive(
  projectId: string,
  client: DbClient = db,
): ProjectExportArchive {
  const initialSnapshot = buildSnapshot(projectId, client);
  const storageRoot = getStorageRoot();
  const lock = initialSnapshot.files.length > 0
    ? (() => {
      verifyStorageOwnership(storageRoot, client);
      const acquired = acquireCleanupLock(storageRoot);
      if (!acquired) {
        throw new ConflictError('Local media maintenance is in progress; retry the export shortly');
      }
      return acquired;
    })()
    : null;

  try {
    // Re-read only after cleanup is excluded, so referenced files cannot disappear mid-export.
    const { manifest, files, root } = lock ? buildSnapshot(projectId, client) : initialSnapshot;
    const zip = new yazl.ZipFile();
    let released = false;
    const releaseLock = () => {
      if (!released) {
        released = true;
        lock?.release();
      }
    };
    zip.outputStream.once('end', releaseLock);
    zip.outputStream.once('close', releaseLock);
    zip.outputStream.once('error', releaseLock);

    for (const session of manifest.sessions) {
      zip.addEmptyDirectory(`${root}/${archiveDirectory(session.title, session.id, 'session')}`);
    }
    for (const file of files) zip.addFile(file.absolutePath, file.archivePath);
    zip.addBuffer(
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
      `${root}/history.json`,
    );
    zip.end();

    return {
      filename: `${root}.zip`,
      stream: zip.outputStream,
    };
  } catch (error) {
    lock?.release();
    throw error;
  }
}

export function buildProjectExportSnapshotForTest(
  projectId: string,
  client: DbClient,
): ProjectExportManifest {
  return buildSnapshot(projectId, client).manifest;
}
