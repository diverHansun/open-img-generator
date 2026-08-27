import packageJson from '../../package.json';
import { describe, expect, it } from 'vitest';

import { APP_LICENSE, APP_VERSION } from './app-info';

describe('application release metadata', () => {
  it('uses package metadata as the only version and license source', () => {
    expect(APP_VERSION).toBe('0.1.0');
    expect(APP_VERSION).toBe(packageJson.version);
    expect(APP_LICENSE).toBe(packageJson.license);
  });
});
