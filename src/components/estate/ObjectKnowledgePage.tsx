'use client';

// ObjectKnowledgePage — the Estate object detail page.
//
// Layout (top → bottom):
//   Header         — breadcrumb, title + actions, path, status chips, summary
//   Sticky nav     — five anchored sections + readiness pill (appears on scroll)
//   Overview       — fact strip (rows, size, columns, period, usage, freshness)
//                    and the DATA readiness card with linked next steps
//   Meaning        — semantic card, entity model, columns, what agents see
//   Relationships  — graph + reviewable list, link to Lineage
//   Operations     — freshness, harvest timeline, profile history, recent jobs
//   Usage          — T3 usage panel
//
// Every section uses SectionHeader so headings, counts and descriptions read
// the same way down the page.

import React, { useCallback, useRef, useState } from 'react';
import Link from '@/lib/navigation/link';

import HeroSection, { ObjectFacts } from './HeroSection';
import InPageNav, { type SectionRefs } from './InPageNav';
import DataReadinessPill from './DataReadinessPill';
import DataReadinessRing from './DataReadinessRing';
import SectionHeader from './SectionHeader';
import SemanticCard from './SemanticCard';
import EntityModelCard from './EntityModelCard';
import ColumnsTable from './ColumnsTable';
import ProfileTimeline from './ProfileTimeline';
import JobsMiniTable from './JobsMiniTable';
import UsagePanel, { type UsageSnapshot } from './UsagePanel';
import type { FreshnessBlock } from './FreshnessCard';
import HarvestTimeline from './HarvestTimeline';
import RelationshipGraph from './RelationshipGraph';
import RelationshipList from './RelationshipList';
import AgentKnowledgePanel, { type AgentKnowledgeChunk } from './AgentKnowledgePanel';
import type { DataScoreShape } from './DataReadinessRing';
import { type } from '@/lib/typography/tokens';

interface ObjectItem {
  id: string;
  source_id: string;
  object_kind: string;
  full_path: string;
  catalog_name: string | null;
  schema_name: string | null;
  object_name: string | null;
  native_comment: string | null;
  row_count_est: any;
  size_bytes_est: any;
  last_t0_at: string | null;
  last_t1_at: string | null;
  last_t2_at: string | null;
  last_t3_at: string | null;
  last_t4_at: string | null;
  last_knowledge_sync_at: string | null;
  entity_tags: any;
  domain_keywords?: string[] | null;
}

export interface ObjectKnowledgePayload {
  object: ObjectItem;
  columns: any[];
  latestSemanticCard: any | null;
  latestSemanticStatus: string | null;
  /** DS3a: the specific semantic card row id — passed to TrustActionBar for version guard */
  latestSemanticId: string | null;
  /** DS3a: version of the semantic card rendered — used for version guard */
  latestSemanticVersion: number | null;
  /** Model / prompt / confidence of the semantic card row. */
  latestSemanticMeta?: { model_id: string | null; prompt_version: string | null; confidence: number | null; created_at: string } | null;
  /** DS3a: embedding presence — Published lifecycle signal */
  hasEmbedding: boolean;
  profileHistory: any[];
  freshness: FreshnessBlock;
  entityGroupObjects: ObjectItem[];
  proposedMappings: any[];
  /** Confirmed column mappings — display only (not scored). */
  confirmedMappings?: any[];
  /** Knowledge chunks agents retrieve for this object. */
  agentKnowledge?: AgentKnowledgeChunk[];
  objectLinks: any[];
  lastJobs: any[];
  usageSnapshot: UsageSnapshot | null;
  semanticModel: {
    entity_id: string;
    entity_model_id: string | null;
    entity_label: string;
    description: string | null;
    status: string;
    dimensions: Array<{ column_name: string; dimension_label: string; dimension_type: string; description: string | null }>;
    measures: Array<{ column_name: string | null; measure_label: string; aggregate: string; description: string | null; unit: string | null }>;
  } | null;
  dataScore: DataScoreShape;
}

interface ObjectKnowledgePageProps {
  data: ObjectKnowledgePayload;
  /** Re-fetch the aggregate (after a harvest action is queued). */
  onRefresh?: () => void;
}

const SECTION_GAP = 56;

function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: '1px dashed var(--estate-border)',
        borderRadius: 12,
        padding: '28px 24px',
        background: 'var(--estate-raised)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        alignItems: 'flex-start',
      }}
    >
      <div style={{ ...type['title-card'], color: 'var(--estate-ink)' }}>{title}</div>
      <div style={{ ...type.ui, color: 'var(--estate-text-muted)', maxWidth: '70ch' }}>{children}</div>
    </div>
  );
}

export default function ObjectKnowledgePage({ data, onRefresh }: ObjectKnowledgePageProps) {
  const {
    object,
    columns,
    latestSemanticCard,
    latestSemanticStatus,
    latestSemanticId,
    hasEmbedding,
    profileHistory,
    freshness,
    entityGroupObjects,
    proposedMappings,
    lastJobs,
    usageSnapshot,
    semanticModel,
    dataScore,
    objectLinks,
    confirmedMappings = [],
    agentKnowledge = [],
  } = data;

  const [columnFocus, setColumnFocus] = useState<string | null>(null);
  const handleColumnFocus = useCallback((name: string) => setColumnFocus(name), []);
  const handleColumnFocusClear = useCallback(() => setColumnFocus(null), []);

  // Refs for the ring (DataReadinessPill IntersectionObserver) and page sections
  const ringRef = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<HTMLElement>(null);
  const meaningRef = useRef<HTMLElement>(null);
  const relationshipsRef = useRef<HTMLElement>(null);
  const operationsRef = useRef<HTMLElement>(null);
  const usageRef = useRef<HTMLElement>(null);

  const sectionRefs: SectionRefs = {
    overview:      overviewRef,
    meaning:       meaningRef,
    relationships: relationshipsRef,
    operations:    operationsRef,
    usage:         usageRef,
  };

  // ── Derived values shared by the nav, header, and sections ──
  const fkCandidates: { column: string; likely_target: string; confidence: number }[] =
    Array.isArray(latestSemanticCard?.fk_candidates) ? latestSemanticCard.fk_candidates : [];
  const coObjects =
    usageSnapshot && Array.isArray(usageSnapshot.co_objects)
      ? (usageSnapshot.co_objects as Array<{ full_path?: string; co_count?: number }>)
          .filter((c): c is { full_path: string; co_count?: number } => !!c.full_path)
          .map((c) => ({
            full_path: c.full_path,
            object_id: usageSnapshot.co_object_id_map?.[c.full_path] ?? undefined,
            co_count: c.co_count,
          }))
      : [];
  const relationshipCount =
    entityGroupObjects.length + fkCandidates.length + objectLinks.length
    + proposedMappings.length + confirmedMappings.length + coObjects.length;
  const pendingReviewCount =
    proposedMappings.length
    + objectLinks.filter((l: { status?: string }) => l.status === 'proposed').length;
  const activeJobKinds = (lastJobs as Array<{ status?: string; job_kind?: string }>)
    .filter((j) => j.status === 'queued' || j.status === 'running')
    .map((j) => j.job_kind ?? 'job');
  const lineageHref = semanticModel
    ? `/agent-lab/estate/lineage?focus=${encodeURIComponent(`e:${semanticModel.entity_id}`)}`
    : null;
  const latestProfileStats = (profileHistory[0]?.stats as any) ?? null;
  const usageWindow = usageSnapshot?.freshness?.window_days ?? 30;

  const hasSemanticContent = latestSemanticCard && (
    latestSemanticCard.summary ||
    latestSemanticCard.grain ||
    latestSemanticCard.key_columns?.length ||
    latestSemanticCard.entity ||
    latestSemanticCard.time_columns?.length
  );

  const sectionStyle: React.CSSProperties = { scrollMarginTop: 64, marginBottom: SECTION_GAP };

  return (
    <div className="overflow-y-auto h-full scrollbar-thin" style={{ scrollBehavior: 'smooth', background: 'var(--estate-bg)' }}>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 1320, margin: '0 auto', padding: '28px 40px 0' }}>
        <HeroSection
          object={object}
          freshness={freshness}
          hasEmbedding={hasEmbedding}
          columns={columns}
          semanticCard={latestSemanticCard}
          semanticStatus={latestSemanticStatus}
          latestProfileStats={latestProfileStats}
          activeJobKinds={activeJobKinds}
          onRefresh={onRefresh}
        />
      </div>

      {/* ── Sticky section nav (readiness pill on the right) ───────── */}
      <InPageNav
        sectionRefs={sectionRefs}
        badges={{
          relationships: relationshipCount > 0
            ? { text: pendingReviewCount > 0 ? `${pendingReviewCount} to review` : String(relationshipCount), tone: pendingReviewCount > 0 ? 'attention' : 'neutral' }
            : undefined,
          meaning: columns.length > 0 ? { text: `${columns.length} cols` } : undefined,
          usage: usageSnapshot ? undefined : { text: 'not harvested' },
        }}
        rightSlot={<DataReadinessPill dataScore={dataScore} ringRef={ringRef} />}
      />

      <div style={{ maxWidth: 1320, margin: '0 auto', padding: '28px 40px 120px' }}>

        {/* ── Overview ─────────────────────────────────────────────── */}
        <section id="overview" ref={overviewRef as React.RefObject<HTMLElement>} style={{ ...sectionStyle, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ObjectFacts
            object={object}
            freshness={freshness}
            columns={columns}
            semanticCard={latestSemanticCard}
            latestProfileStats={latestProfileStats}
            usage={usageSnapshot}
          />
          <div
            style={{
              background: 'var(--estate-raised)',
              border: '1px solid var(--estate-border)',
              borderRadius: 12,
              padding: '22px 24px',
            }}
          >
            <DataReadinessRing dataScore={dataScore} ringRef={ringRef as React.RefObject<HTMLDivElement>} />
          </div>
        </section>

        {/* ── Meaning & trust ──────────────────────────────────────── */}
        <section id="meaning" ref={meaningRef as React.RefObject<HTMLElement>} style={sectionStyle}>
          <SectionHeader
            title="Meaning & trust"
            description="What this table represents, how it is modelled, its columns, and what agents are told about it."
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div id="semantic-card" style={{ scrollMarginTop: 64 }}>
              {hasSemanticContent ? (
                <SemanticCard
                  card={latestSemanticCard}
                  status={latestSemanticStatus || 'assumed'}
                  semanticCardId={latestSemanticId}
                  semanticVersion={data.latestSemanticVersion}
                  objectId={object.id}
                  modelId={data.latestSemanticMeta?.model_id ?? latestSemanticCard?.model_id}
                  promptVersion={data.latestSemanticMeta?.prompt_version ?? latestSemanticCard?.prompt_version}
                  confidence={data.latestSemanticMeta?.confidence ?? latestSemanticCard?.confidence}
                  onColumnClick={handleColumnFocus}
                />
              ) : (
                <EmptyState title="Not described yet">
                  Use <strong style={{ color: 'var(--estate-ink)' }}>Rescan tier → T2 Semantic</strong> at the top of the page
                  to generate a summary, grain, key columns and usage patterns.
                </EmptyState>
              )}
            </div>

            {semanticModel && (
              <EntityModelCard
                entity_id={semanticModel.entity_id}
                entity_model_id={semanticModel.entity_model_id}
                entity_label={semanticModel.entity_label}
                description={semanticModel.description}
                status={semanticModel.status}
                dimensions={semanticModel.dimensions}
                measures={semanticModel.measures}
                totalColumns={columns.length}
                onColumnClick={handleColumnFocus}
              />
            )}

            <div id="columns" style={{ scrollMarginTop: 64 }}>
              <ColumnsTable
                columns={columns}
                focusColumn={columnFocus}
                onFocusClear={handleColumnFocusClear}
              />
            </div>

            <AgentKnowledgePanel
              fullPath={object.full_path}
              chunks={agentKnowledge}
              lastSyncAt={object.last_knowledge_sync_at}
              hasEmbedding={hasEmbedding}
            />
          </div>
        </section>

        {/* ── Relationships ────────────────────────────────────────── */}
        <section id="relationships" ref={relationshipsRef as React.RefObject<HTMLElement>} style={sectionStyle}>
          <SectionHeader
            title="Relationships"
            count={relationshipCount}
            note={pendingReviewCount > 0 ? (
              <span style={{ ...type.caption, color: 'var(--brand-a-ink)', fontWeight: 600 }}>
                {pendingReviewCount} waiting for review
              </span>
            ) : undefined}
            description="Tables this one joins to, shares an entity with, or is queried alongside."
            action={lineageHref ? (
              <Link
                href={lineageHref}
                className="inline-flex h-8 items-center rounded-lg border px-3 text-size-ui font-medium transition-colors hover:bg-[var(--estate-active-bg)]"
                style={{ borderColor: 'var(--estate-btn-border)', color: 'var(--estate-ink)', textDecoration: 'none' }}
                title="Upstream and downstream of this table's business entity"
              >
                Open in Lineage →
              </Link>
            ) : undefined}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <RelationshipGraph
              focusObjectId={object.id}
              focusObjectName={object.object_name ?? object.full_path.split('.').pop() ?? ''}
              focusObjectKind={object.object_kind}
              focusFull={object.full_path}
              entityGroupObjects={entityGroupObjects}
              fkCandidates={fkCandidates}
              objectLinks={objectLinks as any}
              coObjects={coObjects}
            />
            <RelationshipList
              focusObjectId={object.id}
              entityGroupObjects={entityGroupObjects}
              fkCandidates={fkCandidates}
              objectLinks={objectLinks as any}
              proposedMappings={proposedMappings as any}
              confirmedMappings={confirmedMappings as any}
              coObjects={coObjects}
            />
          </div>
        </section>

        {/* ── Operations ───────────────────────────────────────────── */}
        <section id="operations" ref={operationsRef as React.RefObject<HTMLElement>} style={sectionStyle}>
          <SectionHeader
            title="Operations"
            description="How fresh the metadata is, what each harvest step found, and recent jobs."
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Status (steps + freshness) next to the jobs that produced it */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 520px), 1fr))', gap: 16, alignItems: 'stretch' }}>
              <HarvestTimeline
                tiers={{
                  last_t0_at: object.last_t0_at,
                  last_t1_at: object.last_t1_at,
                  last_t2_at: object.last_t2_at,
                  last_t3_at: object.last_t3_at,
                  last_t4_at: object.last_t4_at,
                }}
                freshness={freshness}
                activeJobKinds={activeJobKinds}
              />
              <JobsMiniTable lastJobs={lastJobs} />
            </div>

            {/* Profile versions — full width */}
            <ProfileTimeline profileHistory={profileHistory} />
          </div>
        </section>

        {/* ── Usage ────────────────────────────────────────────────── */}
        <section id="usage" ref={usageRef as React.RefObject<HTMLElement>} style={{ ...sectionStyle, marginBottom: 0 }}>
          <SectionHeader
            title="Usage"
            description={usageSnapshot
              ? `Who queries this table and how, over the last ${usageWindow} days.`
              : 'Who queries this table and how.'}
          />
          {usageSnapshot ? (
            <UsagePanel usage={usageSnapshot} />
          ) : (
            <EmptyState title="Usage not harvested yet">
              Usage is collected for the whole source from the Jobs page (T3). Once it runs, this shows query counts,
              users, common filters and the tables queried alongside this one.
            </EmptyState>
          )}
        </section>

      </div>
    </div>
  );
}
