import InspectorShell from '@/components/inspector/InspectorShell';

export const dynamic = 'force-dynamic';

export default function InspectorPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <InspectorShell />
    </div>
  );
}
