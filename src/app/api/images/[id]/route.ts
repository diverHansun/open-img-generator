import { deleteImageBytes, openDeliverableImage } from '../../../../lib/library';
import { handleApiError } from '../../error-handler';
import { logSafeEvent } from '../../../../lib/observability/safe-logger';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const delivery = openDeliverableImage(id);
    if (delivery.kind === 'remote') {
      logSafeEvent({
        event: 'media.remote_redirect_served',
        imageId: delivery.image.id,
        provider: delivery.provider,
        hostname: delivery.hostname,
        route: 'preview',
      });
      return new Response(null, {
        status: 302,
        headers: {
          Location: delivery.url,
          'Referrer-Policy': 'no-referrer',
          'Cache-Control': 'private, no-store',
        },
      });
    }
    return new Response(delivery.stream as unknown as BodyInit, {
      headers: { 'Content-Type': delivery.image.contentType },
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
