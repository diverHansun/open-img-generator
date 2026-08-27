export const DESKTOP_API_GLOBAL = 'openImageGeneratorDesktop' as const;

export const desktopIpcChannels = {
  runtimeInfo: 'desktop:runtime-info',
  openDataDirectory: 'desktop:open-data-directory',
  chooseDownloadDirectory: 'desktop:choose-download-directory',
  resetDownloadDirectory: 'desktop:reset-download-directory',
} as const;

export type DesktopCredentialStorageMode =
  | 'encrypted-file'
  | 'session-memory';

export type DesktopRuntimeInfo = {
  platform: 'darwin' | 'win32';
  appVersion: string;
  dataDirectory: string;
  downloadDirectory: string;
  defaultDownloadDirectory: string;
  credentialStorageMode: DesktopCredentialStorageMode;
};

export type DesktopBridge = {
  getRuntimeInfo(): Promise<DesktopRuntimeInfo>;
  openDataDirectory(): Promise<void>;
  chooseDownloadDirectory(): Promise<DesktopRuntimeInfo>;
  resetDownloadDirectory(): Promise<DesktopRuntimeInfo>;
};

declare global {
  interface Window {
    openImageGeneratorDesktop?: DesktopBridge;
  }
}

export function getDesktopBridge(): DesktopBridge | undefined {
  return typeof window === 'undefined'
    ? undefined
    : window[DESKTOP_API_GLOBAL];
}
