import { NextResponse } from 'next/server';
import { listEnabled } from '../../../lib/providers';
import { db } from '../../../lib/db';
import { ensureWorkerStarted } from '../../../lib/job-engine';

export function GET() {
  try {
    ensureWorkerStarted();
    db.run('SELECT 1');
    return NextResponse.json({
      status: 'ok',
      enabledProviders: listEnabled().map((p) => p.id),
      db: 'ok',
    });
  } catch (err) {
    console.error('Health check failed:', err);
    return NextResponse.json(
      { status: 'error', enabledProviders: [], db: 'error' },
      { status: 500 },
    );
  }
}
