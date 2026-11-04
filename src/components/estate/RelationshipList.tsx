'use client';

// RelationshipList — every table related to this one, with the reason and the
// review action. Rendered next to RelationshipGraph (graph = shape, list =
// detail + actions).
//
// Groups, in order:
//   1. Needs review       — proposed object links + proposed column mappings
//   2. Joins              — FK candidates from the semantic card
//   3. Same entity        — entity-group siblings
//   4. Queried together   — T3 usage co-objects
//   5. Reviewed           — confirmed / rejected links and confirmed mappings
//
// Mutation endpoints:
//   PATCH /api/agent-lab/context/silo/links/[id]   → { status: 'confirmed' | 'rejected' }
//   PATCH /api/agent-lab/context/mappings/[id]     → { status: 'confirmed' | 'rejected' }
//   Both require current status === 'proposed'. On 409 INVALID_TRANSITION, surface the error.

import React, { useState } from 'react';
import Link from '@/lib/navigation/link';
import { toast } from 'sonner';
import type { FkCandidate, ObjectLinkItem, EntityGroupObject } from './RelationshipGraph';
import { Card, Tag, EmptyNote, BTN_SECONDARY, TONE_COLOR } from './object-ui';
import { type } from '@/lib/typography/tokens';

interface LinkedObject { id: string; full_path: string; object_name: string | null }

interface MappingColumn {
  id: string;
  name: string;
  object_id: string;
  /** Owning table (included by getObjectAggregate). */
  object?: LinkedObject | null;
}

interface MappingItem {
  id: string;
  status: string;
  mapping_kind?: string | null;
  confidence?: number | null;
  left_column: MappingColumn;
  right_column: MappingColumn;
}

type ObjectLinkWithNames = ObjectLinkItem & { left_object?: LinkedObject | null; right_object?: LinkedObject | null };

interface CoObjectItem {
  full_path: string;
  object_id?: string;
  co_count?: number;
}

export interface RelationshipListProps {
  focusObjectId: string;
  entityGroupObjects: EntityGroupObject[];
  fkCandidates: FkCandidate[];
  objectLinks: ObjectLinkItem[];
  proposedMappings: MappingItem[];
  /** Already-confirmed column mappings. */
  confirmedMappings?: MappingItem[];
  coObjects: CoObjectItem[];
}

// link_kind shown as stored (silo_candidate, …).
const LINK_KIND: Record<string, string> = {};

const shortName = (path: string) => path.split('.').pop() ?? path;

// ── Pieces ───────────────────────────────────────────────────────────────────

function Confidence({ value }: { value: number }) {
  const p = Math.max(0, Math.min(1, value));
  const color = p >= 0.8 ? TONE_COLOR.green : p >= 0.5 ? TONE_COLOR.blue : TONE_COLOR.amber;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }} title="Confidence">
      <div style={{ width: 36, height: 4, borderRadius: 999, background: 'var(--estate-active-bg)', overflow: 'hidden' }}>
        <div style={{ width: `${p * 100}%`, height: '100%', background: color }} />
      </div>
      <span style={{ ...type['code-inline'], color: 'var(--estate-text-secondary)', minWidth: 34, textAlign: 'right' }}>{Math.round(p * 100)}%</span>
    </div>
  );
}

function ReviewActions({ endpoint, status, onDone }: { endpoint: string; status: string; onDone: (s: string) => void }) {
  const [loading, setLoading] = useState<'confirmed' | 'rejected' | null>(null);

  if (status !== 'proposed') {
    return status === 'confirmed'
      ? <Tag tone="green" dot>Confirmed</Tag>
      : <Tag tone="red" dot>Rejected</Tag>;
  }

  const send = async (next: 'confirmed' | 'rejected') => {
    if (loading) return;
    setLoading(next);
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) {
        onDone(next);
        toast.success(next === 'confirmed' ? 'Relationship confirmed' : 'Relationship rejected');
      } else {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error === 'INVALID_TRANSITION' ? `Already ${json.current}` : 'Could not save the review');
      }
    } catch {
      toast.error('Could not save the review');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
      <button type="button" disabled={!!loading} onClick={() => send('rejected')} className={BTN_SECONDARY}>
        {loading === 'rejected' ? 'Saving…' : 'Reject'}
      </button>
      <button
        type="button"
        disabled={!!loading}
        onClick={() => send('confirmed')}
        className={BTN_SECONDARY}
        style={{ color: TONE_COLOR.green, borderColor: `color-mix(in srgb, ${TONE_COLOR.green} 40%, transparent)` }}
      >
        {loading === 'confirmed' ? 'Saving…' : 'Confirm'}
      </button>
    </div>
  );
}

function Row({ tag, title, href, subtitle, reason, right }: {
  tag: React.ReactNode;
  title: React.ReactNode;
  href?: string | null;
  subtitle?: React.ReactNode;
  reason?: React.ReactNode;
  right?: React.ReactNode;
}) {
  const titleEl = (
    <span style={{ ...type.ui, fontWeight: 600, color: href ? 'var(--estate-ink)' : 'var(--estate-text-secondary)' }}>
      {title}
    </span>
  );
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 20px',
        borderTop: '1px solid var(--estate-border)',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ width: 120, flexShrink: 0 }}>{tag}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 260px', minWidth: 0 }}>
        {href ? (
          <Link href={href} className="hover:underline" style={{ textDecoration: 'none', width: 'fit-content', maxWidth: '100%' }}>
            {titleEl}
          </Link>
        ) : titleEl}
        {subtitle && (
          <span style={{ ...type.caption, color: 'var(--estate-text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {subtitle}
          </span>
        )}
        {reason && <span style={{ ...type.caption, color: 'var(--estate-text-secondary)' }}>{reason}</span>}
      </div>
      {right && <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>{right}</div>}
    </li>
  );
}

function Group({ label, hint, count, children }: { label: string; hint?: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '14px 20px 8px', background: 'var(--estate-bg)', borderTop: '1px solid var(--estate-border)' }}>
        <span style={{ ...type.eyebrow, color: 'var(--estate-text-secondary)' }}>{label}</span>
        <span style={{ ...type.caption, color: 'var(--estate-text-muted)' }}>{count}{hint ? ` · ${hint}` : ''}</span>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{children}</ul>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function RelationshipList({
  focusObjectId,
  entityGroupObjects,
  fkCandidates,
  objectLinks,
  proposedMappings,
  confirmedMappings = [],
  coObjects,
}: RelationshipListProps) {
  // Optimistic status overrides after confirm / reject
  const [linkStatuses, setLinkStatuses] = useState<Record<string, string>>({});
  const [mappingStatuses, setMappingStatuses] = useState<Record<string, string>>({});

  const links = objectLinks as ObjectLinkWithNames[];
  const proposedLinks = links.filter((l) => l.status === 'proposed');
  const reviewedLinks = links.filter((l) => l.status !== 'proposed');

  const total = entityGroupObjects.length + fkCandidates.length + links.length
    + proposedMappings.length + confirmedMappings.length + coObjects.length;
  const reviewCount = proposedLinks.length + proposedMappings.length;

  const linkRow = (link: ObjectLinkWithNames) => {
    const isLeft = link.left_object_id === focusObjectId;
    const other = isLeft ? link.right_object : link.left_object;
    const otherId = isLeft ? link.right_object_id : link.left_object_id;
    const verdict = (link.llm_verdict as Record<string, unknown> | null)?.verdict;
    const reason = (link.llm_verdict as Record<string, unknown> | null)?.reason ?? (link.llm_verdict as Record<string, unknown> | null)?.rationale;
    const status = linkStatuses[link.id] ?? link.status;
    return (
      <Row
        key={link.id}
        tag={<Tag tone="brand">{LINK_KIND[link.link_kind] ?? link.link_kind}</Tag>}
        title={other ? (other.object_name ?? shortName(other.full_path)) : `Table ${otherId.slice(0, 8)}…`}
        href={`/agent-lab/estate/object/${otherId}`}
        subtitle={other?.full_path}
        reason={typeof reason === 'string' ? reason : typeof verdict === 'string' ? `llm_verdict: ${verdict}` : undefined}
        right={
          <>
            {link.score != null && <Confidence value={link.score} />}
            <ReviewActions
              endpoint={`/api/agent-lab/context/silo/links/${link.id}`}
              status={status}
              onDone={(s) => setLinkStatuses((p) => ({ ...p, [link.id]: s }))}
            />
          </>
        }
      />
    );
  };

  const mappingRow = (m: MappingItem) => {
    const focusIsLeft = m.left_column.object_id === focusObjectId;
    const mine = focusIsLeft ? m.left_column : m.right_column;
    const theirs = focusIsLeft ? m.right_column : m.left_column;
    const theirTable = theirs.object?.object_name ?? (theirs.object?.full_path ? shortName(theirs.object.full_path) : 'another table');
    const status = mappingStatuses[m.id] ?? m.status;
    return (
      <Row
        key={m.id}
        tag={<Tag tone="violet">mapping</Tag>}
        title={
          <span style={{ fontFamily: 'var(--font-mono)' }}>
            {mine.name} <span style={{ color: 'var(--estate-text-muted)', fontWeight: 400 }}>↔</span> {theirTable}.{theirs.name}
          </span>
        }
        href={`/agent-lab/estate/object/${theirs.object_id}`}
        subtitle={theirs.object?.full_path}
        reason={m.mapping_kind ? `mapping_kind: ${m.mapping_kind}` : undefined}
        right={
          <>
            {typeof m.confidence === 'number' && <Confidence value={m.confidence} />}
            <ReviewActions
              endpoint={`/api/agent-lab/context/mappings/${m.id}`}
              status={status}
              onDone={(s) => setMappingStatuses((p) => ({ ...p, [m.id]: s }))}
            />
          </>
        }
      />
    );
  };

  return (
    <Card
      title="Related tables"
      meta={`${total} relationship${total === 1 ? '' : 's'}`}
      actions={reviewCount > 0 ? <Tag tone="brand" dot>{reviewCount} proposed</Tag> : undefined}
      flush
    >
      {total === 0 ? (
        <div style={{ padding: 20 }}>
          <EmptyNote>No relationships found yet. They appear after the table is described (T2), usage is harvested (T3), or a silo scan runs.</EmptyNote>
        </div>
      ) : (
        <div style={{ marginTop: -1 }}>
          <Group label="Proposed" hint="status = proposed" count={reviewCount}>
            {proposedLinks.map(linkRow)}
            {proposedMappings.map(mappingRow)}
          </Group>

          <Group label="FK candidates" hint="semantic card fk_candidates" count={fkCandidates.length}>
            {fkCandidates.map((fk, idx) => (
              <Row
                key={idx}
                tag={<Tag tone="blue">fk_candidate</Tag>}
                title={<span style={{ fontFamily: 'var(--font-mono)' }}>{fk.column} <span style={{ color: 'var(--estate-text-muted)', fontWeight: 400 }}>→</span> {fk.likely_target}</span>}
                reason="Inferred by T2 from column names and values"
                right={<Confidence value={fk.confidence} />}
              />
            ))}
          </Group>

          <Group label="Entity group" hint="entity_tags.groups" count={entityGroupObjects.length}>
            {entityGroupObjects.map((sib) => (
              <Row
                key={sib.id}
                tag={<Tag tone="green">entity_group</Tag>}
                title={sib.object_name || shortName(sib.full_path)}
                href={`/agent-lab/estate/object/${sib.id}`}
                subtitle={sib.full_path}
              />
            ))}
          </Group>

          <Group label="Co-objects (T3)" hint="co_objects from query history" count={coObjects.length}>
            {[...coObjects]
              .sort((a, b) => (b.co_count ?? 0) - (a.co_count ?? 0))
              .map((co, idx) => (
                <Row
                  key={idx}
                  tag={<Tag tone="amber">co_object</Tag>}
                  title={shortName(co.full_path)}
                  href={co.object_id ? `/agent-lab/estate/object/${co.object_id}` : null}
                  subtitle={co.full_path}
                  reason={co.object_id ? undefined : 'Not in the catalog yet'}
                  right={co.co_count != null ? (
                    <span style={{ ...type.ui, color: 'var(--estate-text-secondary)' }}>
                      co_count {co.co_count.toLocaleString()}
                    </span>
                  ) : undefined}
                />
              ))}
          </Group>

          <Group label="Reviewed" hint="confirmed / rejected" count={reviewedLinks.length + confirmedMappings.length}>
            {reviewedLinks.map(linkRow)}
            {confirmedMappings.map(mappingRow)}
          </Group>
        </div>
      )}
    </Card>
  );
}

