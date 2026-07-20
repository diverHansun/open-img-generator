export const HOME_ROUTE = '/' as const;

export const WORKSPACE_SECTIONS = [
  'generate',
  'history',
  'gallery',
  'models',
  'providers',
] as const;

export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number];

function workspaceRoot(projectId: string): string {
  return `/workspace/${encodeURIComponent(projectId)}`;
}

export function workspaceRoute(
  projectId: string,
  section: WorkspaceSection,
): string {
  return `${workspaceRoot(projectId)}/${section}`;
}

export function providerDetailRoute(
  projectId: string,
  providerId: string,
): string {
  return `${workspaceRoute(projectId, 'providers')}/${encodeURIComponent(providerId)}`;
}
