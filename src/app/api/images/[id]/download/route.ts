import { imageDownloadFilename, openDeliverableImage } from '../../../../../lib/library';
import { handleApiError } from '../../../error-handler';
import { logSafeEvent } from '../../../../../lib/observability/safe-logger';

function attachmentHeader(filename: string): string {
  return `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

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
        route: 'download',
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
    const { image, stream } = delivery;
    return new Response(stream as unknown as BodyInit, {
      headers: {
        'Content-Type': image.contentType,
        ...(image.sizeBytes === null
          ? {}
          : { 'Content-Length': String(image.sizeBytes) }),
        'Content-Disposition': attachmentHeader(imageDownloadFilename(image)),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    return handleApiError(err, { structured: true });
  }
}
