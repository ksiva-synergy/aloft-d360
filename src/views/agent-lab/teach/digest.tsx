import { TeachDigest } from '@/components/inspector/teach/TeachDigest';

/**
 * Teach Phase 3 — the read-only candidate hand-off (Digest) surface. Projects the
 * caller's own captured candidates; it does not capture, resolve, promote, or
 * commit. The full Teach page chrome (center thread, learning rail) is Phase 4.
 */
export default function TeachDigestPage() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <TeachDigest />
    </div>
  );
}
