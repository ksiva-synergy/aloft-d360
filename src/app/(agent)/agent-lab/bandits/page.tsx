'use client';

import { BanditsDashboard } from '@/components/agent-lab/BanditsDashboard';

export default function BanditsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6">
        <BanditsDashboard />
      </div>
    </div>
  );
}
