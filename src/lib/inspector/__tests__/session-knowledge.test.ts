import { describe, expect, it } from 'vitest';
import type { TrajectoryEntry } from '@/lib/inspector/agent-loop';
import {
  buildTemplateSessionSummary,
  emptySessionKnowledge,
  formatSessionKnowledgeForPrompt,
  mergeTurnIntoSessionKnowledge,
  parseSessionKnowledge,
  validateNarrativeAgainstFacts,
  withTemplateSummary,
} from '@/lib/inspector/session-knowledge-core';

function traj(partial: Partial<TrajectoryEntry> & Pick<TrajectoryEntry, 'tool'>): TrajectoryEntry {
  return {
    seq: 1,
    sqlExcerpt: null,
    input: {},
    output: null,
    status: 'success',
    durationMs: 10,
    kind: 'discovery',
    ...partial,
  };
}

describe('session-knowledge', () => {
  it('merges describe_schema paths', () => {
    const prev = emptySessionKnowledge();
    const next = mergeTurnIntoSessionKnowledge(prev, [
      traj({
        tool: 'describe_schema',
        input: {
          action: 'describe',
          path: 'landing_zone.db_spv2_somi_dbo.pmslarcomponents',
          connection: 'synergy_dwh',
        },
      }),
    ]);
    expect(next.schemaPaths).toContain('landing_zone.db_spv2_somi_dbo.pmslarcomponents');
  });

  it('extracts vessel entities from SQL row JSON', () => {
    const prev = emptySessionKnowledge();
    const next = mergeTurnIntoSessionKnowledge(prev, [
      traj({
        tool: 'execute_tool',
        input: {
          tool_name: 'synergy_dwh',
          args: {
            statement:
              "SELECT id, name FROM landing_zone.db_spv2_somi_dbo.admvessel WHERE id IN (60, 78) LIMIT 20",
          },
        },
        output: JSON.stringify({
          rows: [
            { id: 78, name: 'EPIC RADIANCE' },
            { id: 60, name: 'EMPRESS ZONDA' },
          ],
        }),
        kind: 'sql_query',
      }),
    ]);
    expect(next.entities.some((e) => e.label === 'EPIC RADIANCE' && e.id === '78')).toBe(true);
    expect(next.entities.some((e) => e.label === 'EMPRESS ZONDA' && e.id === '60')).toBe(true);
  });

  it('adds larparentid heuristic from successful tree SQL', () => {
    const prev = emptySessionKnowledge();
    const next = mergeTurnIntoSessionKnowledge(prev, [
      traj({
        tool: 'execute_tool',
        input: {
          args: {
            statement:
              'WITH RECURSIVE tree AS (SELECT id, larparentid FROM landing_zone.db_spv2_somi_dbo.pmslarcomponents) SELECT * FROM tree LIMIT 10',
          },
        },
        kind: 'sql_query',
      }),
    ]);
    expect(next.heuristics.some((h) => h.includes('larparentid'))).toBe(true);
  });

  it('formats non-empty knowledge for prompt injection', () => {
    const text = formatSessionKnowledgeForPrompt({
      version: 1,
      updatedAt: new Date().toISOString(),
      schemaPaths: ['landing_zone.db_spv2_somi_dbo.admvessel'],
      entities: [{ type: 'vessel', label: 'EPIC RADIANCE', id: '78' }],
      heuristics: ['Use larparentid for tree walks.'],
      task: { goal: 'Spares mapping', status: 'in_progress' },
    });
    expect(text).toContain('SESSION KNOWLEDGE');
    expect(text).toContain('EPIC RADIANCE');
    expect(text).toContain('do not re-discover');
  });

  it('buildTemplateSessionSummary composes goal, entities, and schemas', () => {
    const k = withTemplateSummary({
      version: 1,
      updatedAt: new Date().toISOString(),
      schemaPaths: ['landing_zone.db_spv2_somi_dbo.admvessel'],
      entities: [{ type: 'vessel', label: 'EPIC RADIANCE', id: '78' }],
      heuristics: ['Tree uses larparentid.'],
      task: { goal: 'Spares with components', status: 'in_progress' },
    });
    const summary = buildTemplateSessionSummary(k);
    expect(summary).toContain('Spares with components');
    expect(summary).toContain('EPIC RADIANCE');
    expect(summary).toContain('landing_zone.db_spv2_somi');
  });

  it('formatSessionKnowledgeForPrompt includes template and narrative summaries', () => {
    const text = formatSessionKnowledgeForPrompt({
      version: 1,
      updatedAt: new Date().toISOString(),
      schemaPaths: ['landing_zone.db_spv2_somi_dbo.admvessel'],
      entities: [],
      heuristics: [],
      summaries: {
        template: 'Goal: test (status: exploring).',
        narrative: 'Vessel IDs are confirmed; final extract is still pending.',
      },
    });
    expect(text).toContain('Summary (structured)');
    expect(text).toContain('Summary (narrative)');
  });

  it('validateNarrativeAgainstFacts rejects unknown table paths', () => {
    const k = withTemplateSummary({
      version: 1,
      updatedAt: new Date().toISOString(),
      schemaPaths: ['landing_zone.db_spv2_somi_dbo.admvessel'],
      entities: [],
      heuristics: [],
    });
    expect(validateNarrativeAgainstFacts('See curated_db.other.other_table.', k)).toBe(false);
  });

  it('parseSessionKnowledge round-trips versioned shape', () => {
    const raw = {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      schemaPaths: ['a.b.c'],
      entities: [{ type: 'vessel', label: 'X', id: '1' }],
      heuristics: ['hint'],
      task: { goal: 'g', status: 's' },
    };
    const parsed = parseSessionKnowledge(raw);
    expect(parsed.schemaPaths).toEqual(['a.b.c']);
    expect(parsed.entities[0].id).toBe('1');
  });
});
