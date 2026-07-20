import { ProviderDetailScreen } from '@/components/providers/provider-detail-screen';

export default async function ProviderDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; providerId: string }>;
}) {
  const { projectId, providerId } = await params;
  return (
    <ProviderDetailScreen projectId={projectId} providerId={providerId} />
  );
}
