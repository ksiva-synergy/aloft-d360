import type { FlowTemplate } from './templates';

// Rules-first template matching for "What would you like to accomplish?". Deterministic keyword
// overlap, no model call. It abstains (returns nothing) rather than guessing; an LLM planner is the
// next step for goals no template covers (docs/business-ai-studio/04-harness-skills-reasoning.md).

const STOPWORDS = new Set(
  'a an and are as at be by can do for from get has have i if in into is it its me my need of on or our please so that the then this to us want we when which will with would you every each any all what who how'.split(' '),
);

const stem = (w: string) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

export function tokenize(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !STOPWORDS.has(w)).map(stem))];
}

export type TemplateMatch = { templateId: string; score: number; matched: string[] };

/** Tags score 2, words in the name or summary score 1. A match needs a score of at least 2. */
export function recommendTemplates(goal: string, templates: readonly FlowTemplate[], limit = 3): TemplateMatch[] {
  const words = tokenize(goal);
  if (!words.length) return [];
  return templates
    .map((t) => {
      const tags = new Set(t.tags.flatMap(tokenize));
      const text = new Set(tokenize(`${t.name} ${t.summary}`));
      const matched = words.filter((w) => tags.has(w) || text.has(w));
      const score = words.reduce((sum, w) => sum + (tags.has(w) ? 2 : text.has(w) ? 1 : 0), 0);
      return { templateId: t.id, score, matched };
    })
    .filter((m) => m.score >= 2)
    .sort((a, b) => b.score - a.score || a.templateId.localeCompare(b.templateId))
    .slice(0, limit);
}
