import { redirect } from 'next/navigation';

export default async function WorkspaceIndex({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/workspace/${encodeURIComponent(projectId)}/generate`);
}
