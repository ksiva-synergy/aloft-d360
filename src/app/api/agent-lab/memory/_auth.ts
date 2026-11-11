import { denyUnlessSectionForApi } from '@/lib/sections/api-guard';
import type { NextResponse } from 'next/server';

export async function guardMemoryApi(req: Request): Promise<NextResponse | null> {
  return denyUnlessSectionForApi(req);
}
