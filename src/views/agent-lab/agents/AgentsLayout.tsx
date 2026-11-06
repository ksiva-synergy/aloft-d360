'use client';

import { Outlet } from 'react-router';

/** Saved agents list, per-agent chat, and Workbench share one layout; each surface owns its own header nav (no duplicate tab bar). */
export default function AgentsLayout() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
