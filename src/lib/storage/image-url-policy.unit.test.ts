import { describe, expect, it } from 'vitest';

import {
  RemoteImageUrlError,
  validateRemoteImageUrl,
} from './image-url-policy';

const publicResolver = async () => ['93.184.216.34'];

describe('remote image URL policy', () => {
  it('allows a bounded HTTPS signed URL with publicly resolved addresses', async () => {
    await expect(validateRemoteImageUrl(
      'https://cdn.example.com/image.png?signature=opaque#not-sent',
      { resolveHostname: publicResolver },
    )).resolves.toMatchObject({
      protocol: 'https:',
      hostname: 'cdn.example.com',
      hash: '',
    });
  });

  it('rejects non-HTTPS URLs, credentials, and loopback hostnames', async () => {
    for (const value of [
      'http://cdn.example.com/image.png',
      'https://user:pass@cdn.example.com/image.png',
      'https://localhost/image.png',
      'https://app.localhost/image.png',
      'file:///tmp/image.png',
    ]) {
      await expect(validateRemoteImageUrl(value, { resolveHostname: publicResolver }))
        .rejects.toBeInstanceOf(RemoteImageUrlError);
    }
  });

  it('rejects direct and resolved non-public addresses', async () => {
    for (const value of [
      'https://127.0.0.1/image.png',
      'https://10.0.0.10/image.png',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/image.png',
      'https://[::ffff:127.0.0.1]/image.png',
    ]) {
      await expect(validateRemoteImageUrl(value)).rejects.toBeInstanceOf(RemoteImageUrlError);
    }

    await expect(validateRemoteImageUrl('https://cdn.example.com/image.png', {
      resolveHostname: async () => ['93.184.216.34', '10.0.0.8'],
    })).rejects.toBeInstanceOf(RemoteImageUrlError);
  });

  it('allows a local fake-provider target only with both explicit development switches', async () => {
    await expect(validateRemoteImageUrl('http://127.0.0.1/image.png', {
      allowInsecureHttp: true,
      allowPrivateAddresses: true,
    })).resolves.toMatchObject({ protocol: 'http:' });
  });
});
