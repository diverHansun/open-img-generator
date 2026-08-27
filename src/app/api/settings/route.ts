import { NextResponse } from 'next/server';

import {
  getAppSettings,
  getLocalDataSummary,
  updateAppSettings,
} from '../../../lib/app-settings';
import { APP_LICENSE, APP_VERSION } from '../../../lib/app-info';
import { handleApiError } from '../error-handler';
import { readJsonObject } from '../request-body';

function responseBody() {
  return {
    settings: getAppSettings(),
    localData: getLocalDataSummary(),
    webCapabilities: {
      managesDownloadLocation: false,
      canOpenDataDirectory: false,
    },
    app: {
      version: APP_VERSION,
      license: APP_LICENSE,
    },
  };
}

export function GET() {
  try {
    return NextResponse.json(responseBody(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return handleApiError(err, { structured: true });
  }
}

export async function PUT(request: Request) {
  try {
    updateAppSettings(await readJsonObject(request));
    return NextResponse.json(responseBody(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return handleApiError(err, { structured: true });
  }
}
