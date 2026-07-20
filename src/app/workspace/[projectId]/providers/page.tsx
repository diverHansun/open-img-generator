import { ProvidersScreen } from '@/components/providers/providers-screen';

export default async function ProvidersPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProvidersScreen projectId={projectId} />;
}
