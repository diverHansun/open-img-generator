import { db } from '../../../../../lib/db';
import { ValidationError } from '../../../../../lib/errors';
import { isRemoteImagePinRequired, pinRemoteImage } from '../../../../../lib/library';
import { storeBrowserImageStream } from '../../../../../lib/storage';
import { handleApiError } from '../../../error-handler';

function isOctetStream(request: Request): boolean {
  return request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
    === 'application/octet-stream';
}

/** Accepts bytes the browser could fetch from a CDN when the server could not. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (!isOctetStream(request)) {
      throw new ValidationError('Browser image relay requires application/octet-stream');
    }
    if (!request.body) throw new ValidationError('Browser image relay body is required');
    const { id } = await params;
    if (!isRemoteImagePinRequired(id, db)) return new Response(null, { status: 200 });
    const stored = await storeBrowserImageStream(request.body);
    pinRemoteImage(id, stored, db);
    return new Response(null, { status: 204 });
  } catch (err) {
    return handleApiError(err, { structured: true });
  }
}
