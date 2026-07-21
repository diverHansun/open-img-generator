import { deleteImageBytes, openReadableImage } from '../../../../lib/library';
import { handleApiError } from '../../error-handler';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { image, stream } = openReadableImage(id);
    return new Response(stream as unknown as BodyInit, {
      headers: { 'Content-Type': image.contentType },
    });
  } catch (err) {
    return handleApiError(err, { structured: true });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    deleteImageBytes(id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return handleApiError(err, { structured: true });
  }
}
