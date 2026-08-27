import { VideoGenerateScreen } from '@/components/video-generation/video-generate-screen';

export default async function VideoGenerationPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  return <VideoGenerateScreen projectId={(await params).projectId} />;
}
