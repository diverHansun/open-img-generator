import { Readable } from 'node:stream';

import { db } from '../../../../../lib/db';
import { createProjectExportArchive } from '../../../../../lib/project-export';
import { handleApiError } from '../../../error-handler';

function attachmentHeader(filename: string): string {
  return `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const archive = createProjectExportArchive((await params).id, db);
    return new Response(Readable.toWeb(archive.stream as Readable) as BodyInit, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': attachmentHeader(archive.filename),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    return handleApiError(err, { structured: true });
  }
}
