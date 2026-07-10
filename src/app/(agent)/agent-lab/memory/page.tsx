import type { Metadata } from 'next';
import { FoerStoryDashboard } from '@/components/agent-lab/memory/FoerStoryDashboard';

export const metadata: Metadata = {
  title: 'FOER — Agent Work-Memory · Aloft',
  description:
    'Field-Operational Experience Recall. Cinematic view of agent memory distillation, core rules, and knowledge shelves.',
};

export default function FoerMemoryPage() {
  return (
    <div className="h-full overflow-y-auto">
      <FoerStoryDashboard />
    </div>
  );
}
