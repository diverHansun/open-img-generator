import { getImage } from '../../../../lib/db';
import { getReadStream } from '../../../../lib/storage';
import { handleApiError } from '../../error-handler';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const image = getImage(id);
    const stream = getReadStream(image.storagePath);
    return new Response(stream as unknown as BodyInit, {
      headers: { 'Content-Type': image.contentType },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
