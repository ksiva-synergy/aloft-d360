'use client';

import { useSession } from 'next-auth/react';
import { canRunEstatePipeline } from '@/lib/estate/pipeline-access';

export function useCanRunEstatePipeline(): boolean {
  const { data } = useSession();
  return canRunEstatePipeline((data?.user as { role?: string } | undefined)?.role);
}
