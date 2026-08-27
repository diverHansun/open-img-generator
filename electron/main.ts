import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';

import {
  desktopIpcChannels,
  type DesktopRuntimeInfo,
} from '../src/lib/desktop-bridge';
import { isAllowedExternalUrl } from './security/external-links';
import { resolveCredentialProtection } from './security/credential-secret';
import {
  readDownloadDirectory,
  resolveAvailableDownloadPath,
  writeDownloadDirectory,
} from './runtime/desktop-preferences';
import {
  createDesktopDataPaths,
  createDesktopRuntimeEnvironment,
} from './runtime/environment';
import {
  findAvailableLoopbackPort,
  startLocalServer,
  type RunningLocalServer,
} from './runtime/local-server';

const APP_NAME = 'open image generator';
const AUTH_COOKIE_NAME = 'open_image_generator_auth';
const START_PATH = '/';

let mainWindow: BrowserWindow | null = null;
let localServer: RunningLocalServer | null = null;
let quitting = false;

app.setName(APP_NAME);
if (!app.isPackaged) {
  app.setPath(
    'userData',
    path.join(app.getPath('appData'), `${APP_NAME} Development`),
  );
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function appendDesktopLog(logFile: string, message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    fs.appendFileSync(logFile, line, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Logging must never prevent startup or shutdown.
  }
  if (!app.isPackaged) console.info(message);
}

function isTrustedSender(event: IpcMainInvokeEvent, origin: string): boolean {
  try {
    return Boolean(
      event.senderFrame && new URL(event.senderFrame.url).origin === origin,
    );
  } catch {
    return false;
  }
}

function installContentSecurityPolicy(origin: string): void {
  const scriptPolicy = app.isPackaged
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
  const policy = [
    "default-src 'self'",
    scriptPolicy,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url.startsWith(`${origin}/`)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
}

function createRuntimeInfo(input: {
  dataDirectory: string;
  downloadDirectory: string;
  defaultDownloadDirectory: string;
  credentialStorageMode: 'encrypted-file' | 'session-memory';
}): DesktopRuntimeInfo {
  return {
    platform: process.platform === 'win32' ? 'win32' : 'darwin',
    appVersion: app.getVersion(),
    ...input,
  };
}

async function bootstrap(): Promise<void> {
  const paths = createDesktopDataPaths(app.getPath('userData'));
  for (const directory of [paths.root, paths.images, paths.config, paths.logs]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const logFile = path.join(paths.logs, 'desktop.log');
  const log = (message: string) => appendDesktopLog(logFile, message);
  log(`Starting ${APP_NAME} ${app.getVersion()} (${process.arch})`);

  const credentialProtection = await resolveCredentialProtection(
    paths.config,
    safeStorage,
  );
  if (credentialProtection.warning) {
    log(`Credential protection fallback: ${credentialProtection.warning}`);
  }

  const port = await findAvailableLoopbackPort();
  const authToken = crypto.randomBytes(32).toString('base64url');
  const environment = createDesktopRuntimeEnvironment({
    baseEnvironment: process.env,
    paths,
    port,
    authToken,
    credentialStorageMode: credentialProtection.mode,
    credentialMasterSecret: credentialProtection.masterSecret,
    development: !app.isPackaged,
  });

  localServer = await startLocalServer({
    environment,
    development: !app.isPackaged,
    projectRoot: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    log,
    onUnexpectedExit: () => {
      if (quitting) return;
      localServer = null;
      mainWindow?.destroy();
      mainWindow = null;
      void dialog.showMessageBox({
        type: 'error',
        title: APP_NAME,
        message: 'The local application service stopped unexpectedly.',
        detail: `Diagnostic log: ${logFile}`,
      });
    },
  });

  const origin = localServer.origin;
  await session.defaultSession.cookies.set({
    url: origin,
    name: AUTH_COOKIE_NAME,
    value: authToken,
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: false,
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  installContentSecurityPolicy(origin);

  const defaultDownloadDirectory = app.getPath('downloads');
  let downloadDirectory =
    readDownloadDirectory(paths.config) ?? defaultDownloadDirectory;

  const runtimeInfo = () =>
    createRuntimeInfo({
      dataDirectory: paths.root,
      downloadDirectory,
      defaultDownloadDirectory,
      credentialStorageMode: credentialProtection.mode,
    });

  const requireTrustedSender = (event: IpcMainInvokeEvent) => {
    if (!isTrustedSender(event, origin)) {
      throw new Error('Desktop capability request came from an untrusted origin');
    }
  };

  ipcMain.handle(desktopIpcChannels.runtimeInfo, (event) => {
    requireTrustedSender(event);
    return runtimeInfo();
  });
  ipcMain.handle(desktopIpcChannels.openDataDirectory, async (event) => {
    requireTrustedSender(event);
    const error = await shell.openPath(paths.root);
    if (error) throw new Error(error);
  });
  ipcMain.handle(desktopIpcChannels.chooseDownloadDirectory, async (event) => {
    requireTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose download folder',
      defaultPath: downloadDirectory,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (!result.canceled && result.filePaths[0]) {
      downloadDirectory = path.resolve(result.filePaths[0]);
      writeDownloadDirectory(paths.config, downloadDirectory);
    }
    return runtimeInfo();
  });
  ipcMain.handle(desktopIpcChannels.resetDownloadDirectory, (event) => {
    requireTrustedSender(event);
    downloadDirectory = defaultDownloadDirectory;
    writeDownloadDirectory(paths.config, undefined);
    return runtimeInfo();
  });

  session.defaultSession.on('will-download', (event, item) => {
    try {
      fs.mkdirSync(downloadDirectory, { recursive: true });
      item.setSavePath(
        resolveAvailableDownloadPath(downloadDirectory, item.getFilename()),
      );
    } catch (error) {
      event.preventDefault();
      const errorCode =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : 'unknown';
      log(`Download destination failed (${errorCode})`);
      void dialog.showMessageBox({
        type: 'error',
        title: APP_NAME,
        message: 'The download could not be saved.',
        detail: 'Choose a writable download folder in Settings and try again.',
      });
    }
  });

  await createMainWindow(origin);
}

async function createMainWindow(origin: string): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: APP_NAME,
    backgroundColor: '#f4f7f2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(`${origin}/`)) return;
    event.preventDefault();
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  await mainWindow.loadURL(`${origin}${START_PATH}`);
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && localServer) {
    void createMainWindow(localServer.origin).catch(handleFatalStartupError);
  }
});

app.on('before-quit', (event) => {
  if (quitting || !localServer) return;
  event.preventDefault();
  quitting = true;
  void localServer.stop().finally(() => {
    localServer = null;
    app.quit();
  });
});

function handleFatalStartupError(error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  void dialog.showMessageBox({
    type: 'error',
    title: APP_NAME,
    message: 'The desktop application could not start.',
    detail,
  }).finally(() => app.quit());
}

if (hasSingleInstanceLock) {
  app.whenReady().then(bootstrap).catch(handleFatalStartupError);
}
