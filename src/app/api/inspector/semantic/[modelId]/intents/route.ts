import { NextRequest, NextResponse } from 'next/server';
import { getDefaultOrg } from '@/lib/platform/agents';
import { listGovernedIntents } from '@/lib/semantic/intent-match';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inspector/semantic/[modelId]/intents?limit=5  (Phase 3.5D)
 *
 * Returns the org's GOVERNED NL-intents for this model — the real questions the
 * org has authored-and-governed answers for — most-recent first. These become
 * the top tier of empty-state starter prompts, above the deterministic
 * {measure}-over-{dimension} templates.
 *
 * Governed-only + org-wide by construction (listGovernedIntents). A user's
 * private draft intent never appears here.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> },
) {
  try {
    const org = await getDefaultOrg();
    const { modelId } = await params;
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 5, 1), 10);

    const intents = await listGovernedIntents(org.id, { limit, modelId });
    return NextResponse.json({
      intents: intents.map((i) => ({
        intentText: i.intentText,
        label: i.label,
        sourceType: i.sourceType,
        sourceId: i.sourceId,
      })),
    });
  } catch (err) {
    console.error('[semantic/intents GET]', err);
    return NextResponse.json({ intents: [] });
  }
}
