import type { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import { notFound } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getCurrentTopicMap } from '@/lib/foer/topics';
import { FoerOpsDashboard } from '@/components/agent-lab/memory/FoerOpsDashboard';

export const metadata: Metadata = {
  title: 'FOER Ops — Memory Operations · Aloft',
  description: 'Pipeline health, synthesis run history, memory canary, and injection preview.',
};

export default async function FoerOpsPage() {
  const session = await getServerSession(authOptions);
  if (!session) return notFound();

  const org = await getDefaultOrg();
  const topicMapRaw = await getCurrentTopicMap(org.id);

  const topicMap = Object.fromEntries(topicMapRaw);

  return (
    <div className="h-full overflow-y-auto">
      <FoerOpsDashboard topicMap={topicMap} />
    </div>
  );
}
