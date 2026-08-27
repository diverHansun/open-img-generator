import { isIP } from 'node:net';

import { doubaoModelSpecs } from '../providers/capabilities/doubao';
import { falModelSpecs } from '../providers/capabilities/fal';
import { qwenModelSpecs } from '../providers/capabilities/qwen';
import { siliconflowModelSpecs } from '../providers/capabilities/siliconflow';
import { zenmuxModelSpecs } from '../providers/capabilities/zenmux';
import { zhipuModelSpecs } from '../providers/capabilities/zhipu';
import type { ProviderImageOutputSpec, ProviderModelSpec } from '../providers/model-spec';
import type { ProviderId } from '../providers/types';

const MAX_REMOTE_URL_LENGTH = 8 * 1024;

export class RemoteImageUrlError extends Error {
  readonly code = 'REMOTE_IMAGE_URL_REJECTED';
}

function modelSpec(provider: ProviderId, model: string): ProviderModelSpec<unknown> | undefined {
  const specs: ReadonlyMap<string, ProviderModelSpec<unknown>> =
    provider === 'doubao' ? doubaoModelSpecs
      : provider === 'fal' ? falModelSpecs
        : provider === 'qwen' ? qwenModelSpecs
          : provider === 'siliconflow' ? siliconflowModelSpecs
            : provider === 'zenmux' ? zenmuxModelSpecs
              : zhipuModelSpecs;
  return specs.get(model);
}

function hostMatches(hostname: string, rule: string): boolean {
  const normalizedRule = rule.toLowerCase().replace(/\.$/, '');
  if (!normalizedRule.startsWith('.')) return hostname === normalizedRule;
  const root = normalizedRule.slice(1);
  return hostname === root || hostname.endsWith(normalizedRule);
}

function parseAllowedRemoteUrl(rawUrl: string, output: ProviderImageOutputSpec): URL {
  if (rawUrl.length === 0 || rawUrl.length > MAX_REMOTE_URL_LENGTH) {
    throw new RemoteImageUrlError('Remote image URL length is invalid');
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new RemoteImageUrlError('Remote image URL is invalid');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.hash !== ''
  ) {
    throw new RemoteImageUrlError('Remote image URL structure is not allowed');
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' || isIP(hostname) !== 0) {
    throw new RemoteImageUrlError('Remote image host is not allowed');
  }
  if (!output.allowedRemoteHosts.some((rule) => hostMatches(hostname, rule))) {
    throw new RemoteImageUrlError('Remote image host is not declared by the model');
  }
  return parsed;
}

export type AcceptedRemoteImage = {
  url: string;
  hostname: string;
  expiresAt: string | null;
};

/** Structural validation only: this deliberately performs no DNS or media request. */
export function acceptProviderRemoteImage(
  provider: ProviderId,
  model: string,
  rawUrl: string,
  now = Date.now(),
): AcceptedRemoteImage {
  const output = modelSpec(provider, model)?.imageOutput;
  if (!output || output.delivery === 'inline') {
    throw new RemoteImageUrlError('Model does not declare remote image output');
  }
  const parsed = parseAllowedRemoteUrl(rawUrl, output);
  return {
    url: parsed.toString(),
    hostname: parsed.hostname.toLowerCase().replace(/\.$/, ''),
    expiresAt: output.remoteTtlMs === undefined
      ? null
      : new Date(now + output.remoteTtlMs).toISOString(),
  };
}
