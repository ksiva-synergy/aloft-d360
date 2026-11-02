'use client';

import { BanditsDashboard } from '@/components/agent-lab/BanditsDashboard';

export default function BanditsPage() {
  return (
    <div className="born-page h-full overflow-y-auto">
      <div className="p-6">
        <h1 className="sr-only">Bandits</h1>
        <BanditsDashboard />
      </div>
    </div>
  );
}
