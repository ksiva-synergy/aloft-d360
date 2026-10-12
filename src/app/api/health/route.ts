import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** ALB / Elastic Beanstalk health check */
export async function GET() {
  return NextResponse.json({ ok: true });
}
