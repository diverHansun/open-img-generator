import packageJson from '../../package.json';

/** Every user-facing surface reads the release version from package metadata. */
export const APP_VERSION = packageJson.version;
export const APP_LICENSE = packageJson.license;
