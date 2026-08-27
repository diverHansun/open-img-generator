import { GalleryScreen } from '@/components/gallery/gallery-screen';

export default async function GalleryPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <GalleryScreen projectId={projectId} />;
}
