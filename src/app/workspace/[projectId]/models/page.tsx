import { ModelsScreen } from '@/components/models/models-screen';

export default async function ModelsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ModelsScreen key={projectId} projectId={projectId} />;
}
