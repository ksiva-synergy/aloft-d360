import { Outlet } from 'react-router';
import { useSession } from 'next-auth/react';
import { UnifiedAgentSidebar } from '@/components/agent-lab/staging/StagingSidebar';
import { StagingHeader } from '@/components/agent-lab/staging/StagingHeader';

/** Same markup as `(agent)/layout.tsx`; the session now comes from `useSession()` instead of the server. */
export function AgentLayout() {
  const { data: session } = useSession();
  return (
    <div
      className="flex h-screen overflow-hidden bg-[var(--shell-bg)]"
      style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}
    >
      <UnifiedAgentSidebar initialSession={session} />
      <div
        className="flex min-w-0 flex-1 flex-col overflow-hidden"
        style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}
      >
        <StagingHeader />
        <main
          className="flex-1 overflow-y-auto overflow-x-hidden bg-[var(--main-bg)]"
          style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
