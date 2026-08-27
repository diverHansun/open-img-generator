import { getVideo } from '../../../../lib/db';
import { getReadStream } from '../../../../lib/storage';
import { handleApiError } from '../../error-handler';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const video = getVideo((await params).id);
    if (!video.storagePath) return new Response(null, { status: 410 });
    return new Response(getReadStream(video.storagePath) as unknown as BodyInit, {
      headers: {
        'Content-Type': video.contentType,
        'Accept-Ranges': 'none',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    return handleApiError(err, { structured: true });
  }
}
