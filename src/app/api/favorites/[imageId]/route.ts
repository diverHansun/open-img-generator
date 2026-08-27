import { db } from '../../../../lib/db';
import { removeFavorite } from '../../../../lib/library';
import { handleApiError } from '../../error-handler';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ imageId: string }> },
) {
  try {
    removeFavorite((await params).imageId, db);
    return new Response(null, { status: 204 });
  } catch (err) {
    return handleApiError(err);
  }
}
