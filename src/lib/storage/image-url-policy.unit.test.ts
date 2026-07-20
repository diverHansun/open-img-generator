import { afterEach, describe, expect, it } from 'vitest';

import {
  RemoteImageUrlError,
  validateRemoteImageUrl,
} from './image-url-policy';

const publicResolver = async () => ['93.184.216.34'];
const originalTrustedProxyImageHosts = process.env.TRUSTED_PROXY_IMAGE_HOSTS;

afterEach(() => {
  if (originalTrustedProxyImageHosts === undefined) {
    delete process.env.TRUSTED_PROXY_IMAGE_HOSTS;
  } else {
    process.env.TRUSTED_PROXY_IMAGE_HOSTS = originalTrustedProxyImageHosts;
  }
});

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

  it('allows a configured HTTPS CDN only when every answer is proxy-mapped', async () => {
    process.env.TRUSTED_PROXY_IMAGE_HOSTS = ' V3B.FAL.MEDIA ';

    await expect(validateRemoteImageUrl('https://v3b.fal.media/result.jpeg', {
      resolveHostname: async () => ['198.18.0.125'],
    })).resolves.toMatchObject({ hostname: 'v3b.fal.media' });
  });

  it('rejects proxy-mapped addresses for unconfigured, mixed, or non-proxy targets', async () => {
    process.env.TRUSTED_PROXY_IMAGE_HOSTS = 'v3b.fal.media, 198.18.0.125, *.fal.media, https://bad.example';

    await expect(validateRemoteImageUrl('https://cdn.fal.media/result.jpeg', {
      resolveHostname: async () => ['198.18.0.125'],
    })).rejects.toBeInstanceOf(RemoteImageUrlError);

    await expect(validateRemoteImageUrl('https://v3b.fal.media/result.jpeg', {
      resolveHostname: async () => ['198.18.0.125', '93.184.216.34'],
    })).rejects.toBeInstanceOf(RemoteImageUrlError);

    await expect(validateRemoteImageUrl('https://v3b.fal.media/result.jpeg', {
      resolveHostname: async () => ['10.0.0.8'],
    })).rejects.toBeInstanceOf(RemoteImageUrlError);

    await expect(validateRemoteImageUrl('http://v3b.fal.media/result.jpeg', {
      resolveHostname: async () => ['198.18.0.125'],
    })).rejects.toBeInstanceOf(RemoteImageUrlError);

    await expect(validateRemoteImageUrl('https://198.18.0.125/result.jpeg'))
      .rejects.toBeInstanceOf(RemoteImageUrlError);
  });

  it('allows a local fake-provider target only with both explicit development switches', async () => {
    await expect(validateRemoteImageUrl('http://127.0.0.1/image.png', {
      allowInsecureHttp: true,
      allowPrivateAddresses: true,
    })).resolves.toMatchObject({ protocol: 'http:' });
  });
});
