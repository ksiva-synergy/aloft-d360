'use client';

// ObjectKnowledgePage — DS3c updated.
//
// Region 3 (Relationships) renders RelationshipGraph + RelationshipList
// unconditionally (always alongside each other — not a conditional fallback).
//
// Region 4 (Operations): HarvestTimeline (T0–T4 status strip), FreshnessCard
// (detail view), ProfileTimeline (field-corrected), JobsMiniTable (drill-down links).
//
// Region 5 (Usage): UsagePanel with zero-row suppression and simplified
// co-objects (compact summary + anchor link to #relationships).

import React, { useCallback, useRef, useState } from 'react';
import Link from 'next/link';

import HeroSection from './HeroSection';
import InPageNav, { type SectionRefs } from './InPageNav';
import DataReadinessPill from './DataReadinessPill';
import SemanticCard from './SemanticCard';
import EntityModelCard from './EntityModelCard';
import ColumnsTable from './ColumnsTable';
import ProfileTimeline from './ProfileTimeline';
import JobsMiniTable from './JobsMiniTable';
import UsagePanel, { type UsageSnapshot } from './UsagePanel';
import FreshnessCard, { type FreshnessBlock } from './FreshnessCard';
import HarvestTimeline from './HarvestTimeline';
import RelationshipGraph from './RelationshipGraph';
import RelationshipList from './RelationshipList';
import type { DataScoreShape } from './DataReadinessRing';

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
  /** DS3a: embedding presence — Published lifecycle signal */
  hasEmbedding: boolean;
  profileHistory: any[];
  freshness: FreshnessBlock;
  entityGroupObjects: ObjectItem[];
  proposedMappings: any[];
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
}

export default function ObjectKnowledgePage({ data }: ObjectKnowledgePageProps) {
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

  const labelColor = 'var(--estate-text-secondary)';
  const mutedColor = 'var(--estate-text-muted)';
  const cardBg = 'var(--estate-raised)';
  const borderColor = 'var(--estate-border-gold)';

  const hasSemanticContent = latestSemanticCard && (
    latestSemanticCard.summary ||
    latestSemanticCard.grain ||
    latestSemanticCard.key_columns?.length ||
    latestSemanticCard.entity ||
    latestSemanticCard.time_columns?.length
  );

  return (
    <div className="overflow-y-auto h-full scrollbar-thin bg-[var(--background)]" style={{ scrollBehavior: 'smooth' }}>

      {/* Sticky readiness pill — DS2, persists across ALL sections per OPEN-B */}
      <DataReadinessPill dataScore={dataScore} ringRef={ringRef} />

      {/* Anchored in-page navigation */}
      <InPageNav sectionRefs={sectionRefs} />

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '28px 40px 100px' }}>

        {/* Breadcrumb */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: '"IBM Plex Mono", monospace',
            fontSize: 12,
            color: labelColor,
            marginBottom: 24,
          }}
        >
          <Link href="/agent-lab/estate" style={{ color: labelColor, textDecoration: 'none' }} className="hover:text-[#FDB515] transition-colors">
            Data Estate
          </Link>
          <span>›</span>
          <Link href="/agent-lab/estate/catalog" style={{ color: labelColor, textDecoration: 'none' }} className="hover:text-[#FDB515] transition-colors">
            Catalog
          </Link>
          <span>›</span>
          <span>{object.schema_name || 'default'}</span>
          <span>›</span>
          <span style={{ color: 'var(--estate-ink)', fontWeight: 600 }}>
            {object.object_name || 'unnamed'}
          </span>
        </div>

        {/* ── SECTION: Overview (Hero) ────────────────────────────────── */}
        <section
          id="overview"
          ref={overviewRef as React.RefObject<HTMLElement>}
          style={{ scrollMarginTop: 100, marginBottom: 44 }}
        >
          <HeroSection
            object={object}
            dataScore={dataScore}
            freshness={freshness}
            hasEmbedding={hasEmbedding}
            ringRef={ringRef}
          />
        </section>

        {/* ── SECTION: Meaning & Trust ────────────────────────────────── */}
        <section
          id="meaning"
          ref={meaningRef as React.RefObject<HTMLElement>}
          style={{ scrollMarginTop: 100, marginBottom: 44 }}
        >
          <div
            style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: labelColor,
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span>Meaning & Trust</span>
            <span style={{ opacity: 0.3 }}>—</span>
            <span style={{ opacity: 0.5, fontWeight: 400, fontSize: 10 }}>STEWARD / ANALYST</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Semantic Card */}
            {hasSemanticContent ? (
              <SemanticCard
                card={latestSemanticCard}
                status={latestSemanticStatus || 'assumed'}
                semanticCardId={latestSemanticId}
                semanticVersion={data.latestSemanticVersion}
                objectId={object.id}
                modelId={latestSemanticCard?.model_id}
                promptVersion={latestSemanticCard?.prompt_version}
                confidence={latestSemanticCard?.confidence}
                onColumnClick={handleColumnFocus}
              />
            ) : (
              <div
                style={{
                  border: `1px dashed ${borderColor}`,
                  borderRadius: 8,
                  padding: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  background: cardBg,
                }}
              >
                <span style={{ fontSize: 20, opacity: 0.2 }}>✦</span>
                <div>
                  <div
                    style={{
                      fontFamily: '"IBM Plex Mono", monospace',
                      fontSize: 11,
                      fontWeight: 600,
                      color: labelColor,
                      marginBottom: 4,
                    }}
                  >
                    No semantic context yet
                  </div>
                  <div
                    style={{
                      fontFamily: '"Inter Tight", sans-serif',
                      fontSize: 12,
                      color: mutedColor,
                    }}
                  >
                    Run <strong style={{ color: '#FDB515' }}>Re-enrich (T2)</strong> from the action bar above to generate an AI summary, grain, key columns, and usage patterns.
                  </div>
                </div>
              </div>
            )}

            {/* T4 Entity Model Card — extracted, unified card system */}
            {semanticModel && (
              <EntityModelCard
                entity_id={semanticModel.entity_id}
                entity_model_id={semanticModel.entity_model_id}
                entity_label={semanticModel.entity_label}
                description={semanticModel.description}
                status={semanticModel.status}
                dimensions={semanticModel.dimensions}
                measures={semanticModel.measures}
              />
            )}

            {/* Columns Schema — demoted to strong secondary */}
            <ColumnsTable
              columns={columns}
              focusColumn={columnFocus}
              onFocusClear={handleColumnFocusClear}
            />

          </div>
        </section>

        {/* ── SECTION: Relationships ──────────────────────────────────── */}
        <section
          id="relationships"
          ref={relationshipsRef as React.RefObject<HTMLElement>}
          style={{ scrollMarginTop: 100, marginBottom: 44 }}
        >
          <div
            style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: labelColor,
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span>Relationships</span>
            <span style={{ opacity: 0.3 }}>—</span>
            <span style={{ opacity: 0.5, fontWeight: 400, fontSize: 10 }}>4 SOURCES · CONSOLIDATED</span>
          </div>

          {/* Graph (pattern spotting) + List (detail + actions) — always co-rendered */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* RelationshipGraph — React Flow + dagre */}
            <RelationshipGraph
              focusObjectId={object.id}
              focusObjectName={object.object_name ?? object.full_path.split('.').pop() ?? ''}
              focusObjectKind={object.object_kind}
              focusFull={object.full_path}
              entityGroupObjects={entityGroupObjects}
              fkCandidates={
                Array.isArray(latestSemanticCard?.fk_candidates)
                  ? (latestSemanticCard.fk_candidates as { column: string; likely_target: string; confidence: number }[])
                  : []
              }
              objectLinks={objectLinks as any}
              coObjects={
                usageSnapshot
                  ? (Array.isArray(usageSnapshot.co_objects)
                    ? (usageSnapshot.co_objects as Array<{ full_path?: string; co_count?: number }>)
                        .filter((c): c is { full_path: string; co_count?: number } => !!c.full_path)
                        .map((c) => ({
                          full_path: c.full_path,
                          object_id: usageSnapshot.co_object_id_map?.[c.full_path] ?? undefined,
                          co_count: c.co_count,
                        }))
                    : [])
                  : []
              }
            />

            {/* RelationshipList — detail + confirm/reject actions, always rendered */}
            <RelationshipList
              focusObjectId={object.id}
              entityGroupObjects={entityGroupObjects}
              fkCandidates={
                Array.isArray(latestSemanticCard?.fk_candidates)
                  ? (latestSemanticCard.fk_candidates as { column: string; likely_target: string; confidence: number }[])
                  : []
              }
              objectLinks={objectLinks as any}
              proposedMappings={proposedMappings as any}
              coObjects={
                usageSnapshot
                  ? (Array.isArray(usageSnapshot.co_objects)
                    ? (usageSnapshot.co_objects as Array<{ full_path?: string; co_count?: number }>)
                        .filter((c): c is { full_path: string; co_count?: number } => !!c.full_path)
                        .map((c) => ({
                          full_path: c.full_path,
                          object_id: usageSnapshot.co_object_id_map?.[c.full_path] ?? undefined,
                          co_count: c.co_count,
                        }))
                    : [])
                  : []
              }
            />

          </div>
        </section>

        {/* ── SECTION: Operations ─────────────────────────────────────── */}
        <section
          id="operations"
          ref={operationsRef as React.RefObject<HTMLElement>}
          style={{ scrollMarginTop: 100, marginBottom: 44 }}
        >
          <div
            style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: labelColor,
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span>Operations</span>
            <span style={{ opacity: 0.3 }}>—</span>
            <span style={{ opacity: 0.5, fontWeight: 400, fontSize: 10 }}>DATA ENGINEER</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Top row: Freshness + Harvest Timeline — full width */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
              <FreshnessCard freshness={freshness} />
              <HarvestTimeline
                tiers={{
                  last_t0_at: object.last_t0_at,
                  last_t1_at: object.last_t1_at,
                  last_t2_at: object.last_t2_at,
                  last_t3_at: object.last_t3_at,
                  last_t4_at: object.last_t4_at,
                }}
              />
            </div>

            {/* Bottom row: Profile Run History (60%) + Recent Jobs (40%) */}
            <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16, alignItems: 'start' }}>
              <div style={{ minHeight: 200 }}>
                <div
                  style={{
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: labelColor,
                    marginBottom: 12,
                  }}
                >
                  Profile Run History
                </div>
                <ProfileTimeline profileHistory={profileHistory} />
              </div>

              <div>
                <div
                  style={{
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: labelColor,
                    marginBottom: 12,
                  }}
                >
                  Recent Jobs
                </div>
                <JobsMiniTable lastJobs={lastJobs} />
              </div>
            </div>
          </div>
        </section>

        {/* ── SECTION: Usage ──────────────────────────────────────────── */}
        <section
          id="usage"
          ref={usageRef as React.RefObject<HTMLElement>}
          style={{ scrollMarginTop: 100, marginBottom: 44 }}
        >
          <div
            style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: labelColor,
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span>Usage</span>
            <span style={{ opacity: 0.3 }}>—</span>
            <span style={{ opacity: 0.5, fontWeight: 400, fontSize: 10 }}>T3 · LAST 30 DAYS</span>
          </div>

          {usageSnapshot ? (
            <UsagePanel usage={usageSnapshot} />
          ) : (
            <div
              style={{
                border: `1px dashed ${borderColor}`,
                borderRadius: 8,
                padding: '24px',
                textAlign: 'center',
                background: cardBg,
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: 11,
                color: mutedColor,
              }}
            >
              No usage data — run T3 Usage harvest to populate
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
