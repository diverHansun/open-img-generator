import { contextBridge, ipcRenderer } from 'electron';

import {
  DESKTOP_API_GLOBAL,
  desktopIpcChannels,
  type DesktopBridge,
} from '../src/lib/desktop-bridge';

const bridge: DesktopBridge = Object.freeze({
  getRuntimeInfo: () => ipcRenderer.invoke(desktopIpcChannels.runtimeInfo),
  openDataDirectory: () =>
    ipcRenderer.invoke(desktopIpcChannels.openDataDirectory),
  chooseDownloadDirectory: () =>
    ipcRenderer.invoke(desktopIpcChannels.chooseDownloadDirectory),
  resetDownloadDirectory: () =>
    ipcRenderer.invoke(desktopIpcChannels.resetDownloadDirectory),
});

contextBridge.exposeInMainWorld(DESKTOP_API_GLOBAL, bridge);
