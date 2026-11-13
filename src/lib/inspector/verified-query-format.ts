import type { VerifiedQueryHit } from '@/lib/powerbi/verified-query-match';

export function formatVerifiedQueryBlock(hits: VerifiedQueryHit[]): string {
  if (hits.length === 0) return '';

  const lines: string[] = [
    '## VERIFIED QUERIES (Power BI parity)',
    '',
    'When the user question matches one of these, call **run_verified_query** with the id below.',
    'Do not rewrite or compile SQL — the stored statement is already validated against Power BI.',
    'In your answer, note that the value matches the cited Power BI model (provenance is returned by the tool).',
    'If none match, continue with catalog search / execute_tool as usual.',
    '',
    '| id | score | question | model |',
    '|---|---:|---|---|',
  ];

  for (const h of hits) {
    const model =
      typeof h.props.model_name === 'string' ? h.props.model_name.replace(/\|/g, '/') : '—';
    const q = h.question.replace(/\|/g, '/').slice(0, 120);
    lines.push(`| ${h.id} | ${h.score.toFixed(2)} | ${q} | ${model} |`);
  }

  return lines.join('\n');
}
