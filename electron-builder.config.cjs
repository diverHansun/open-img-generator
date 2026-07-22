const path = require('node:path');

const arch = process.env.DESKTOP_TARGET_ARCH || process.arch;
const signingEnabled = process.env.DESKTOP_SIGNING_ENABLED === '1';

module.exports = {
  appId: 'com.diverhansun.openimagegenerator',
  productName: 'open image generator',
  electronVersion: '43.2.0',
  asar: true,
  npmRebuild: false,
  forceCodeSigning: signingEnabled,
  directories: {
    app: '.',
    output: path.resolve(__dirname, 'dist', 'desktop'),
  },
  files: ['**/*', '!package-lock.json'],
  extraResources: [
    {
      from: path.resolve(__dirname, '.desktop-runtime', arch),
      to: 'app-runtime',
      filter: ['**/*'],
    },
  ],
  mac: {
    category: 'public.app-category.graphics-design',
    identity: signingEnabled ? undefined : null,
    hardenedRuntime: signingEnabled,
    notarize: signingEnabled,
    target: ['dmg'],
    artifactName: '${productName}-${version}-${arch}.${ext}',
  },
  dmg: {
    sign: false,
  },
};
