import { describe, expect, it } from 'vitest';

import {
  classifyProviderDiagnostic,
  toSafeProviderDiagnostic,
} from './error-diagnostics';

describe('provider error diagnostics', () => {
  it.each([
    ['fal', 'content_policy_violation', 'content_policy', undefined],
    ['zenmux', 'provider_unprocessable_entity_error', 'upstream_rejected', undefined],
    ['siliconflow', undefined, 'rate_limited', 429],
    ['zhipu', '1301', 'content_policy', undefined],
    ['doubao', 'InputImageSensitiveContentDetected', 'content_policy', undefined],
    ['qwen', 'InvalidParameter.DataInspection', 'remote_asset_unavailable', undefined],
    ['kling', '1102', 'billing_or_access', undefined],
  ] as const)(
    'classifies %s errors only from documented safe codes',
    (providerId, providerCode, category, httpStatus) => {
      expect(
        classifyProviderDiagnostic(providerId, { providerCode, httpStatus }),
      ).toMatchObject({ category, ...(providerCode ? { providerCode } : {}) });
    },
  );

  it('retains a safe provider request id but never forwards an unknown code', () => {
    const diagnostic = classifyProviderDiagnostic('zenmux', {
      httpStatus: 422,
      providerCode: 'PROMPT=https://signed.example/image?token=secret',
      providerRequestId: 'req-9d4b-1',
    });

    expect(diagnostic).toEqual({
      providerId: 'zenmux',
      category: 'input_invalid',
      providerRequestId: 'req-9d4b-1',
    });
    expect(JSON.stringify(diagnostic)).not.toContain('signed.example');
  });

  it('drops malformed fields read from a legacy persisted diagnostic', () => {
    expect(
      toSafeProviderDiagnostic({
        providerId: 'qwen',
        category: 'content_policy',
        providerCode: 'private prompt with whitespace',
        providerRequestId: 'https://signed.example/image?token=secret',
      }),
    ).toEqual({ providerId: 'qwen', category: 'content_policy' });
  });

  it('drops an otherwise well-formed provider code unless that provider documents it', () => {
    expect(
      toSafeProviderDiagnostic({
        providerId: 'zenmux',
        category: 'input_invalid',
        providerCode: 'syntactically-safe-but-unknown',
        providerRequestId: 'req-123',
      }),
    ).toEqual({
      providerId: 'zenmux',
      category: 'input_invalid',
      providerRequestId: 'req-123',
    });
  });
});
