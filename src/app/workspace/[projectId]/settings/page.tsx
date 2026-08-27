import { SettingsScreen } from '@/components/settings/settings-screen';

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <SettingsScreen projectId={projectId} />;
}
