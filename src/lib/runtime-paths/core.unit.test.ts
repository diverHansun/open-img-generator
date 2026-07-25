import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  RuntimePathError,
  parseSqliteDatabasePath,
  resolveRuntimeMode,
  resolveRuntimePaths,
} from './core.js';

describe('runtime path policy', () => {
  const winProjectRoot = 'D:\\Projects\\图像 工具';
  const winHome = 'C:\\Users\\测试 用户';

  it('keeps all development data below the project data directory', () => {
    expect(resolveRuntimePaths({
      mode: 'development',
      platform: 'win32',
      projectRoot: winProjectRoot,
      homeDirectory: winHome,
      env: {},
    })).toEqual({
      databasePath: 'D:\\Projects\\图像 工具\\data\\app.db',
      storageRoot: 'D:\\Projects\\图像 工具\\data\\images',
      userConfigDirectory: 'D:\\Projects\\图像 工具\\data\\config',
      logDirectory: 'D:\\Projects\\图像 工具\\data\\logs',
    });
  });

  it('uses LOCALAPPDATA for Windows production defaults', () => {
    expect(resolveRuntimePaths({
      mode: 'production',
      platform: 'win32',
      projectRoot: winProjectRoot,
      homeDirectory: winHome,
      localAppData: 'C:\\Users\\测试 用户\\AppData\\Local',
      env: {},
    })).toEqual({
      databasePath: 'C:\\Users\\测试 用户\\AppData\\Local\\Open Image Generator\\app.db',
      storageRoot: 'C:\\Users\\测试 用户\\AppData\\Local\\Open Image Generator\\images',
      userConfigDirectory: 'C:\\Users\\测试 用户\\AppData\\Local\\Open Image Generator\\config',
      logDirectory: 'C:\\Users\\测试 用户\\AppData\\Local\\Open Image Generator\\logs',
    });
  });

  it('falls back to the Windows home profile when LOCALAPPDATA is missing', () => {
    const paths = resolveRuntimePaths({
      mode: 'production',
      platform: 'win32',
      projectRoot: winProjectRoot,
      homeDirectory: winHome,
      env: {},
    });
    expect(paths.databasePath).toBe(
      'C:\\Users\\测试 用户\\AppData\\Local\\Open Image Generator\\app.db',
    );
  });

  it('applies independent non-blank environment overrides', () => {
    const paths = resolveRuntimePaths({
      mode: 'development',
      platform: 'win32',
      projectRoot: winProjectRoot,
      homeDirectory: winHome,
      env: {
        DATABASE_URL: 'file:./custom/db.sqlite',
        LOCAL_STORAGE_DIR: '.\\custom\\图片',
        USER_CONFIG_DIR: '   ',
        APP_LOG_DIR: 'D:\\runtime logs',
      },
    });
    expect(paths).toEqual({
      databasePath: 'D:\\Projects\\图像 工具\\custom\\db.sqlite',
      storageRoot: 'D:\\Projects\\图像 工具\\custom\\图片',
      userConfigDirectory: 'D:\\Projects\\图像 工具\\data\\config',
      logDirectory: 'D:\\runtime logs',
    });
  });

  it.each([
    ['file:./data/app.db', 'D:\\Projects\\图像 工具\\data\\app.db'],
    ['.\\data\\app.db', 'D:\\Projects\\图像 工具\\data\\app.db'],
    ['C:\\Data Folder\\图像.db', 'C:\\Data Folder\\图像.db'],
    ['c:\\Data Folder\\图像.db', 'C:\\Data Folder\\图像.db'],
    ['file:///C:/Data%20Folder/%E5%9B%BE%E5%83%8F.db', 'C:\\Data Folder\\图像.db'],
    ['file://localhost/C:/Data/app.db', 'C:\\Data\\app.db'],
    [':memory:', ':memory:'],
  ])('parses local SQLite path %s', (input, expected) => {
    expect(parseSqliteDatabasePath(input, {
      platform: 'win32',
      projectRoot: winProjectRoot,
    })).toBe(expected);
  });

  it.each([
    'https://example.com/app.db',
    '\\\\server\\share\\app.db',
    '//server/share/app.db',
    'file://server/share/app.db',
  ])('rejects non-local SQLite target %s', (input) => {
    expect(() => parseSqliteDatabasePath(input, {
      platform: 'win32',
      projectRoot: winProjectRoot,
    })).toThrow(RuntimePathError);
  });

  it.each([
    'file:./data/app.db?mode=ro',
    'file:./data/app.db#fragment',
    'file:///C:/Data/app.db?mode=ro',
    'file:///C:/Data/app.db#fragment',
  ])('rejects unsupported SQLite URI options in %s', (input) => {
    try {
      parseSqliteDatabasePath(input, {
        platform: 'win32',
        projectRoot: winProjectRoot,
      });
      throw new Error('Expected parseSqliteDatabasePath to reject URI options');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'UNSUPPORTED_DATABASE_URL_OPTIONS',
        resource: 'database',
      });
    }
  });

  it('preserves existing non-Windows production defaults', () => {
    expect(resolveRuntimePaths({
      mode: 'production',
      platform: 'linux',
      projectRoot: '/srv/open image generator',
      homeDirectory: '/home/tester',
      env: {},
    })).toEqual({
      databasePath: '/srv/open image generator/data/app.db',
      storageRoot: '/srv/open image generator/data/images',
      userConfigDirectory: '/home/tester/.config/open-image-generator',
      logDirectory: '/srv/open image generator/data/logs',
    });
  });

  it('resolves mode with CLI precedence and rejects invalid values', () => {
    expect(resolveRuntimeMode({ cliMode: 'production', nodeEnv: 'development' })).toBe('production');
    expect(resolveRuntimeMode({ nodeEnv: 'test' })).toBe('test');
    expect(resolveRuntimeMode({})).toBe('development');
    expect(() => resolveRuntimeMode({ cliMode: 'preview' })).toThrow(RuntimePathError);
  });

  it('uses the selected platform path implementation instead of the host platform', () => {
    expect(path.win32.isAbsolute(parseSqliteDatabasePath('file:./app.db', {
      platform: 'win32',
      projectRoot: winProjectRoot,
    }))).toBe(true);
  });
});
