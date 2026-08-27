import { describe, expect, it } from 'vitest';

import {
  MAX_PROVIDER_EXTERNAL_ID_LENGTH,
  ProviderEndpointError,
  providerEndpointUrl,
  trustedProviderBaseUrl,
  trustedProviderExternalId,
  trustedSameOriginProviderUrl,
} from './endpoint-policy';

describe('provider endpoint policy', () => {
  it('accepts HTTP(S) base URLs without credentials, queries, or fragments', () => {
    expect(trustedProviderBaseUrl('https://provider.example/api/v1/').toString()).toBe(
      'https://provider.example/api/v1/',
    );

    for (const value of [
      'ftp://provider.example/api',
      'https://user:password@provider.example/api',
      'https://provider.example/api?credential=leak',
      'https://provider.example/api#fragment',
      'not a URL',
    ]) {
      expect(() => trustedProviderBaseUrl(value)).toThrow(ProviderEndpointError);
    }
  });

  it('constructs paths from encoded segments rather than concatenating untrusted IDs', () => {
    const base = trustedProviderBaseUrl('https://provider.example/api/v1/');
    expect(providerEndpointUrl(base, ['tasks', 'task/../?signed=true'])).toBe(
      'https://provider.example/api/v1/tasks/task%2F..%2F%3Fsigned%3Dtrue',
    );
    expect(() => providerEndpointUrl(base, ['tasks', '..'])).toThrow(ProviderEndpointError);
  });

  it('requires bounded string task IDs', () => {
    expect(trustedProviderExternalId('task-1')).toBe('task-1');
    for (const value of ['', '.', '..']) {
      expect(() => trustedProviderExternalId(value)).toThrow(ProviderEndpointError);
    }
    expect(() => trustedProviderExternalId('x'.repeat(MAX_PROVIDER_EXTERNAL_ID_LENGTH + 1)))
      .toThrow(ProviderEndpointError);
    expect(() => trustedProviderExternalId({ id: 'task-1' })).toThrow(ProviderEndpointError);
  });

  it('allows signed Fal URLs only on its configured exact origin', () => {
    expect(trustedSameOriginProviderUrl(
      'https://queue.fal.run/request/1/status?signature=opaque',
      'https://queue.fal.run',
    )).toBe('https://queue.fal.run/request/1/status?signature=opaque');

    for (const value of [
      'https://queue.fal.run.attacker.example/request/1',
      'https://queue.fal.run@attacker.example/request/1',
      'http://queue.fal.run/request/1',
      'file:///request/1',
    ]) {
      expect(() => trustedSameOriginProviderUrl(value, 'https://queue.fal.run'))
        .toThrow(ProviderEndpointError);
    }
  });
});
