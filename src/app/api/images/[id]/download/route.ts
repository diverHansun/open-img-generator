import { imageDownloadFilename, openReadableImage } from '../../../../../lib/library';
import { handleApiError } from '../../../error-handler';

function attachmentHeader(filename: string): string {
  return `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { image, stream } = openReadableImage(id);
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
