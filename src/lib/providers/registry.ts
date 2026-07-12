import type { ImageProvider, ProviderId, ProviderInfo } from './types';
import { FalProvider } from './adapters/fal';
import { ZenmuxProvider } from './adapters/zenmux';

const registry = new Map<ProviderId, ImageProvider>();

function isEnabled(id: ProviderId): boolean {
  switch (id) {
    case 'fal':
      return !!process.env.FAL_KEY;
    case 'zenmux':
      return !!process.env.ZENMUX_API_KEY;
    default:
      return false;
  }
}

function createAdapter(id: ProviderId): ImageProvider | undefined {
  switch (id) {
    case 'fal':
      return new FalProvider();
    case 'zenmux':
      return new ZenmuxProvider();
    default:
      return undefined;
  }
}

function ensureAdapter(id: ProviderId): ImageProvider | undefined {
  if (!isEnabled(id)) return undefined;
  if (!registry.has(id)) {
    const adapter = createAdapter(id);
    if (adapter) {
      registry.set(id, adapter);
    }
  }
  return registry.get(id);
}

export function getById(id: ProviderId): ImageProvider | undefined {
  return ensureAdapter(id);
}

export function listEnabled(): ProviderInfo[] {
  const allIds: ProviderId[] = ['fal', 'zenmux'];
  return allIds
    .map((id) => {
      const provider = ensureAdapter(id);
      if (!provider) return undefined;
      return {
        id: provider.id,
        displayName: provider.displayName,
        models: Array.from(provider.capabilities.values()),
      };
    })
    .filter((info): info is ProviderInfo => info !== undefined);
}
