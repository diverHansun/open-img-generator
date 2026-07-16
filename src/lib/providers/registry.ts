import type { ImageProvider, ProviderId, ProviderInfo } from './types';
import { FalProvider } from './adapters/fal';
import { ZenmuxProvider } from './adapters/zenmux';
import { SiliconFlowProvider } from './adapters/siliconflow';
import { ZhipuProvider } from './adapters/zhipu';
import { DoubaoProvider } from './adapters/doubao';
import { QwenProvider } from './adapters/qwen';

const registry = new Map<ProviderId, ImageProvider>();

type ProviderDefinition = {
  isEnabled: () => boolean;
  create: () => ImageProvider;
};

const providerOrder: ProviderId[] = [
  'fal',
  'zenmux',
  'siliconflow',
  'zhipu',
  'doubao',
  'qwen',
  'kling',
];

const definitions: Partial<Record<ProviderId, ProviderDefinition>> = {
  fal: { isEnabled: () => !!process.env.FAL_KEY, create: () => new FalProvider() },
  zenmux: {
    isEnabled: () => !!process.env.ZENMUX_API_KEY,
    create: () => new ZenmuxProvider(),
  },
  siliconflow: {
    isEnabled: () => !!process.env.SILICONFLOW_API_KEY,
    create: () => new SiliconFlowProvider(),
  },
  zhipu: {
    isEnabled: () => !!process.env.ZHIPU_API_KEY,
    create: () => new ZhipuProvider(),
  },
  doubao: {
    isEnabled: () => !!process.env.ARK_API_KEY,
    create: () => new DoubaoProvider(),
  },
  qwen: {
    isEnabled: () => !!process.env.DASHSCOPE_API_KEY,
    create: () => new QwenProvider(),
  },
};

function ensureAdapter(id: ProviderId): ImageProvider | undefined {
  const definition = definitions[id];
  if (!definition || !definition.isEnabled()) return undefined;
  if (!registry.has(id)) {
    registry.set(id, definition.create());
  }
  return registry.get(id);
}

export function getById(id: ProviderId): ImageProvider | undefined {
  return ensureAdapter(id);
}

export function listEnabled(): ProviderInfo[] {
  return providerOrder
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
