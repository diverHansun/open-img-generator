import { HistoryScreen } from '@/components/history/history-screen';

export default async function HistoryPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <HistoryScreen projectId={projectId} />;
}
