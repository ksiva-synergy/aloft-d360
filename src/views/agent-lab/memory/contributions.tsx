import { MemoryCredCard } from '@/components/dashboard/MemoryCredCard';

export default function MemoryContributionsPage() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h1
            className="text-[1.4rem] font-semibold tracking-tight"
            style={{ fontFamily: '"Inter Variable", Inter, sans-serif' }}
          >
            Memory Contributions
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Per-domain memory-cred leaderboard — reputation earned through accepted memory contributions.
          </p>
        </div>
        <MemoryCredCard />
      </div>
    </div>
  );
}
