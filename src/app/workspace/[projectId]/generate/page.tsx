import { GenerateScreen } from '@/components/generate/generate-screen';

export default async function GeneratePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ generation?: string | string[] }>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const requestedGeneration = Array.isArray(query.generation)
    ? query.generation[0]
    : query.generation;
  return (
    <GenerateScreen
      key={projectId}
      projectId={projectId}
      initialGenerationId={requestedGeneration?.trim() || null}
    />
  );
}
