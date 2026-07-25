import path from 'node:path';

const RUNTIME_MODES = new Set(['development', 'production', 'test']);

export class RuntimePathError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'RuntimePathError';
    this.code = options.code ?? 'INVALID_RUNTIME_PATH';
    this.resource = options.resource;
    this.path = options.path;
  }
}

function nonBlank(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function pathApiFor(platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

function rejectNetworkPath(value, platform, resource) {
  const slashNormalized = value.replaceAll('\\', '/');
  if (slashNormalized.startsWith('//')) {
    throw new RuntimePathError(`${resource} must use a local filesystem path`, {
      code: 'NETWORK_PATH_NOT_SUPPORTED',
      resource,
      path: value,
    });
  }
  if (platform === 'win32' && path.win32.isAbsolute(value) && value.startsWith('\\')) {
    throw new RuntimePathError(`${resource} must not use a UNC path`, {
      code: 'NETWORK_PATH_NOT_SUPPORTED',
      resource,
      path: value,
    });
  }
}

function resolveLocalPath(value, options, resource) {
  const platform = options.platform ?? process.platform;
  const pathApi = pathApiFor(platform);
  const normalized = nonBlank(value);
  if (!normalized) {
    throw new RuntimePathError(`${resource} path is empty`, {
      code: 'EMPTY_RUNTIME_PATH',
      resource,
    });
  }
  rejectNetworkPath(normalized, platform, resource);
  if (/^[a-z][a-z\d+.-]*:/i.test(normalized) && !/^[a-z]:[\\/]/i.test(normalized)) {
    throw new RuntimePathError(`${resource} must use a local filesystem path`, {
      code: 'UNSUPPORTED_PATH_SCHEME',
      resource,
      path: normalized,
    });
  }
  const resolved = pathApi.resolve(options.projectRoot, normalized);
  return platform === 'win32'
    ? resolved.replace(/^([a-z]):/, (_, drive) => `${drive.toUpperCase()}:`)
    : resolved;
}

function rejectDatabaseUrlOptions(value, search = '', hash = '') {
  if (search || hash || /[?#]/.test(value.slice('file:'.length))) {
    throw new RuntimePathError('DATABASE_URL does not support SQLite URI options', {
      code: 'UNSUPPORTED_DATABASE_URL_OPTIONS',
      resource: 'database',
      path: value,
    });
  }
}

function parseFileUrl(value, options) {
  let url;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new RuntimePathError('DATABASE_URL is not a valid file URL', {
      code: 'INVALID_DATABASE_URL',
      resource: 'database',
      path: value,
      cause,
    });
  }
  if (url.protocol !== 'file:') {
    throw new RuntimePathError('DATABASE_URL only supports local file paths', {
      code: 'UNSUPPORTED_DATABASE_SCHEME',
      resource: 'database',
      path: value,
    });
  }
  rejectDatabaseUrlOptions(value, url.search, url.hash);
  if (url.hostname && url.hostname.toLowerCase() !== 'localhost') {
    throw new RuntimePathError('DATABASE_URL must not use a network file URL', {
      code: 'NETWORK_PATH_NOT_SUPPORTED',
      resource: 'database',
      path: value,
    });
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (cause) {
    throw new RuntimePathError('DATABASE_URL contains invalid URL encoding', {
      code: 'INVALID_DATABASE_URL',
      resource: 'database',
      path: value,
      cause,
    });
  }
  if ((options.platform ?? process.platform) === 'win32') {
    pathname = pathname.replace(/^\/(?=[a-z]:\/)/i, '').replaceAll('/', '\\');
  }
  return resolveLocalPath(pathname, options, 'database');
}

export function parseSqliteDatabasePath(value, options) {
  const normalized = nonBlank(value);
  if (!normalized) {
    throw new RuntimePathError('DATABASE_URL is empty', {
      code: 'EMPTY_RUNTIME_PATH',
      resource: 'database',
    });
  }
  if (normalized === ':memory:') return normalized;
  if (/^file:\/\//i.test(normalized)) return parseFileUrl(normalized, options);
  if (/^file:/i.test(normalized)) {
    rejectDatabaseUrlOptions(normalized);
    return resolveLocalPath(normalized.slice('file:'.length), options, 'database');
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(normalized) && !/^[a-z]:[\\/]/i.test(normalized)) {
    throw new RuntimePathError('DATABASE_URL only supports local SQLite files', {
      code: 'UNSUPPORTED_DATABASE_SCHEME',
      resource: 'database',
      path: normalized,
    });
  }
  return resolveLocalPath(normalized, options, 'database');
}

export function resolveRuntimeMode(input = {}) {
  const value = nonBlank(input.cliMode) ?? nonBlank(input.nodeEnv) ?? 'development';
  if (!RUNTIME_MODES.has(value)) {
    throw new RuntimePathError(`Unsupported runtime mode: ${value}`, {
      code: 'INVALID_RUNTIME_MODE',
      resource: 'mode',
    });
  }
  return value;
}

export function resolveRuntimePaths(input) {
  const platform = input.platform ?? process.platform;
  const pathApi = pathApiFor(platform);
  const projectRoot = pathApi.resolve(input.projectRoot);
  const env = input.env ?? {};
  const mode = resolveRuntimeMode({ cliMode: input.mode, nodeEnv: env.NODE_ENV });
  const homeDirectory = nonBlank(input.homeDirectory) ?? projectRoot;
  const developmentRoot = pathApi.join(projectRoot, 'data');

  let databaseDefault = pathApi.join(developmentRoot, 'app.db');
  let storageDefault = pathApi.join(developmentRoot, 'images');
  let configDefault = pathApi.join(developmentRoot, 'config');
  let logDefault = pathApi.join(developmentRoot, 'logs');

  if (mode === 'production') {
    if (platform === 'win32') {
      const localAppData = nonBlank(input.localAppData)
        ?? nonBlank(env.LOCALAPPDATA)
        ?? pathApi.join(homeDirectory, 'AppData', 'Local');
      const productionRoot = pathApi.join(localAppData, 'Open Image Generator');
      databaseDefault = pathApi.join(productionRoot, 'app.db');
      storageDefault = pathApi.join(productionRoot, 'images');
      configDefault = pathApi.join(productionRoot, 'config');
      logDefault = pathApi.join(productionRoot, 'logs');
    } else {
      configDefault = pathApi.join(homeDirectory, '.config', 'open-image-generator');
    }
  }

  return {
    databasePath: parseSqliteDatabasePath(
      nonBlank(env.DATABASE_URL) ?? databaseDefault,
      { platform, projectRoot },
    ),
    storageRoot: resolveLocalPath(
      nonBlank(env.LOCAL_STORAGE_DIR) ?? storageDefault,
      { platform, projectRoot },
      'storage',
    ),
    userConfigDirectory: resolveLocalPath(
      nonBlank(env.USER_CONFIG_DIR) ?? configDefault,
      { platform, projectRoot },
      'config',
    ),
    logDirectory: resolveLocalPath(
      nonBlank(env.APP_LOG_DIR) ?? logDefault,
      { platform, projectRoot },
      'logs',
    ),
  };
}
