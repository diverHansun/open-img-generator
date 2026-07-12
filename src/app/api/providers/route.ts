import { NextResponse } from 'next/server';
import { listEnabled } from '../../../lib/providers';

export function GET() {
  return NextResponse.json(listEnabled());
}
