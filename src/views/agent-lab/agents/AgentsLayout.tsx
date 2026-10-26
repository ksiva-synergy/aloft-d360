'use client';

import { Outlet } from 'react-router';
import AgentsSubNav from './AgentsSubNav';

export default function AgentsLayout() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <AgentsSubNav />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
