import { WorkspaceShell } from '@/components/shell/workspace-shell';

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <WorkspaceShell projectId={projectId}>{children}</WorkspaceShell>;
}
