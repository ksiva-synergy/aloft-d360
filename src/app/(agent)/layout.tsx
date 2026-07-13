import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { UnifiedAgentSidebar } from '@/components/agent-lab/staging/StagingSidebar';
import { StagingHeader } from '@/components/agent-lab/staging/StagingHeader';

export default async function AgentGroupLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  return (
    <div
      className="flex h-screen overflow-hidden bg-[var(--shell-bg)]"
      style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}
    >
      <UnifiedAgentSidebar initialSession={session} />
      <div
        className="flex-1 flex flex-col overflow-hidden"
        style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}
      >
        <StagingHeader />
        <main className="flex-1 overflow-y-auto bg-[var(--main-bg)]" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>{children}</main>
      </div>
    </div>
  );
}
