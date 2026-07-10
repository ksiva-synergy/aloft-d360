import React from 'react';
import EstateNav from './EstateNav';

export default function EstateLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col overflow-hidden bg-[var(--background)]">
      <EstateNav />
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
