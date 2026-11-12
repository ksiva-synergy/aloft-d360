/**
 * Extracts follow-up suggestions from the tail of an Inspector or Workbench assistant reply.
 *
 * Handles both:
 * 1. Trailing markdown bullet / numbered lists (`- Break the 645 mismatches...`)
 * 2. Prose "I can ..." / "Next I can ..." / "Want me to ..." sentences that list
 *    2–3 comma/or-separated follow-ups (e.g. "I can break the 645 mismatches by office
 *    or department, list the 339 Ship Management people costed to Corporate Functions,
 *    or show the same split by employment type (permanent vs contract).").
 */

const PROSE_OFFER_LEAD_RE =
  /^(?:(?:next|from here|if you(?:'d| would) like|if useful|if you want)[,\s]+)?(?:i\s+(?:can|could)(?:\s+also|\s+next)?|we\s+(?:can|could)(?:\s+also|\s+next)?|you\s+(?:can|could|might)(?:\s+also|\s+next)?\s+ask(?:\s+me)?\s+to|want\s+me\s+to)\s+(.+?)[.?]?$/i;

const ACTION_CLAUSE_START_RE =
  /^(?:or\s+)?(break\b|list\b|show\b|check\b|compare\b|pull\b|filter\b|group\b|rank\b|chart\b|plot\b|drill\b|map\b|count\b|summarize\b|summarise\b|analyze\b|analyse\b|look\s+up\b|lookup\b|find\b|split\b|trace\b|export\b|review\b|see\b|inspect\b|join\b|attach\b)/i;

function capFirst(s: string): string {
  const t = s.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

function cleanSuggestionItem(raw: string): string {
  return capFirst(
    raw
      .trim()
      .replace(/^\*\*([^*]+)\*\*\s*(?:—|–|-|:)\s*.+$/, '$1') // "**Title** — explanation" -> "Title"
      .replace(/\*\*/g, '')
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/[.;:]+$/, '')
      .trim(),
  );
}

/**
 * Split a prose offer body like:
 *   "break the 645 mismatches by office or department, list the 339 Ship Management people costed to Corporate Functions, or show the same split by employment type (permanent vs contract)"
 * into individual actionable clauses.
 */
export function parseProseOfferLine(line: string): string[] {
  const cleanedLine = line.trim().replace(/\*\*/g, '');
  const m = cleanedLine.match(PROSE_OFFER_LEAD_RE);
  if (!m) return [];

  let body = m[1].trim().replace(/[.;]+$/, '');
  // Drop trailing filler like "if you want that next" or "if needed"
  body = body.replace(/\s+if\s+you\s+(?:want|need|like|prefer)\b.*$/i, '').trim();
  if (!ACTION_CLAUSE_START_RE.test(body)) return [];

  // 1. Split on ", or " / "; or " / "; "
  const primaryParts = body.split(/\s*(?:,\s+or\s+|;\s+or\s+|;\s+)\s*/i);
  const clauses: string[] = [];

  for (const part of primaryParts) {
    // 2. Split on ", <action_verb> " (e.g. ", list the 339..." or ", check how many...")
    const subParts = part.split(
      /,\s+(?=(?:or\s+)?(?:break|list|show|check|compare|pull|filter|group|rank|chart|plot|drill|map|count|summarize|summarise|analyze|analyse|look\s+up|lookup|find|split|trace|export|review|see|inspect|join|attach)\b)/i,
    );
    for (const sp of subParts) {
      // 3. If a clause still has " or <action_verb> " (e.g. "break ... by criticality or pull the vessel..."), split there too
      const orParts = sp.split(
        /\s+or\s+(?=(?:break|list|show|check|compare|pull|filter|group|rank|chart|plot|drill|map|count|summarize|summarise|analyze|analyse|look\s+up|lookup|find|split|trace|export|review|see|inspect|join|attach)\s+(?:the\b|how\b|which\b|only\b|all\b|by\b|whether\b|what\b|who\b|where\b|each\b|open\b|active\b|overdue\b|\d))/i,
      );
      for (const op of orParts) {
        const trimmed = op.replace(/^or\s+/i, '').trim();
        if (trimmed) clauses.push(trimmed);
      }
    }
  }

  return clauses
    .map(cleanSuggestionItem)
    .filter((c) => c.length >= 8 && c.length <= 120);
}

export function extractSuggestionsFromText(text: string): string[] {
  const lines = text.split('\n');
  const bulletResults: string[] = [];
  let inBlock = false;
  /** A blank line or heading ended the current bullet list (outside a lead-in block). */
  let afterGap = false;

  // Walk the tail of the message looking for explicit bulleted/numbered suggestions
  const startIdx = Math.max(0, lines.length - 16);
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('|') || line.startsWith('#')) {
      if (inBlock && bulletResults.length > 0) break;
      if (bulletResults.length > 0) afterGap = true;
      continue;
    }
    // A new list after a gap: the earlier list was answer content (e.g. "- Revenue is about 4.24 billion"),
    // and only the last list can be the closing follow-ups.
    if (afterGap && !inBlock && /^[-*•]\s+/.test(line)) bulletResults.length = 0;
    afterGap = false;
    const lc = line.toLowerCase();
    if (
      lc.includes('you might') ||
      lc.includes('next step') ||
      lc.includes('follow-up') ||
      lc.includes('you could') ||
      lc.includes('try:') ||
      lc.includes('options:') ||
      lc.includes('starting points:') ||
      lc.includes('next questions')
    ) {
      // Bullets before the lead-in belong to the answer.
      bulletResults.length = 0;
      inBlock = true;
      continue;
    }

    const bulletMatch = line.match(/^[-*•]\s+(.+)/) || (inBlock ? line.match(/^\d+[.)]\s+(.+)/) : null);
    if (bulletMatch) {
      const txt = cleanSuggestionItem(bulletMatch[1]);
      if (txt.length >= 6 && txt.length <= 120) bulletResults.push(txt);
    } else if (inBlock && line.endsWith('?')) {
      const txt = cleanSuggestionItem(line.replace(/^[-*•\d+.)\s]+/, ''));
      if (txt.length >= 8 && txt.length <= 120) bulletResults.push(txt);
    } else if (bulletResults.length > 0 && !line.match(/^[-*•\d]/)) {
      // If a non-bullet line appears after an earlier bullet list, the earlier list was part of the body, not the closing suggestions.
      if (!inBlock) bulletResults.length = 0;
      else inBlock = false;
    }
  }

  if (bulletResults.length > 0) {
    return bulletResults.slice(0, 3);
  }

  // Fallback: check the last few non-empty paragraphs for a prose "I can X, Y, or Z." sentence
  const nonEmptyTail = lines
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('|') && !l.startsWith('#'))
    .slice(-4)
    .reverse();

  for (const para of nonEmptyTail) {
    // Check each sentence in the paragraph from last to first
    const sentences = para.split(/(?<=[.?!])\s+/).reverse();
    for (const sentence of sentences) {
      const proseItems = parseProseOfferLine(sentence);
      if (proseItems.length > 0) {
        return proseItems.slice(0, 3);
      }
    }
    const wholeLineItems = parseProseOfferLine(para);
    if (wholeLineItems.length > 0) {
      return wholeLineItems.slice(0, 3);
    }
  }

  return [];
}

const BULLET_RE = /^\s*(?:[-*•]|\d+[.)])\s+/;
const QUESTION_START_RE = /^(?:which|what|who|whom|where|when|why|how|should|do|does|did|is|are|can|could|would|will|want)\b/i;
/** A short line that introduces the follow-ups ("Next questions:", "Want to go further?"). */
const LEAD_IN_RE =
  /(next questions?|next steps?|follow-?ups?|you might|you could|want me to|would you like|if you(?:'d| would) like|i can (?:also |next )?|we can (?:also |next )?|from here|go further|dig deeper|options|try|starting points)/i;

function looksLikeFollowUp(item: string): boolean {
  return item.endsWith('?') || ACTION_CLAUSE_START_RE.test(item) || QUESTION_START_RE.test(item);
}

function sameItems(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Follow-ups for the pills, plus the reply without them, so they show once (as pills) and not
 * also as bullets or an "I can ..." sentence at the end of the answer.
 *
 * The closing block is removed only when it is the very end of the reply, matches the extracted
 * items exactly, and reads as follow-ups (questions or action phrases, or it has a lead-in line).
 * Anything else stays in the text: losing part of an answer is worse than a repeated suggestion.
 */
export function splitFollowUps(text: string): { body: string; items: string[] } {
  const items = extractSuggestionsFromText(text);
  const keep = { body: text, items };
  if (items.length === 0) return keep;

  const lines = text.trimEnd().split('\n');
  let start = lines.length;
  while (start > 0 && BULLET_RE.test(lines[start - 1])) start--;

  if (start < lines.length) {
    const block = lines.slice(start).map((l) => cleanSuggestionItem(l.trim().replace(BULLET_RE, '')));
    if (!sameItems(block, items)) return keep;
    let cut = start;
    let prev = start - 1;
    while (prev >= 0 && !lines[prev].trim()) prev--;
    const lead = prev >= 0 ? lines[prev].trim() : '';
    const hasLeadIn = lead.length > 0 && lead.length <= 160 && /[:?]$/.test(lead) && LEAD_IN_RE.test(lead);
    if (hasLeadIn) cut = prev;
    else if (!block.every(looksLikeFollowUp)) return keep;
    const body = lines.slice(0, cut).join('\n').trimEnd();
    return body.trim() ? { body, items } : keep;
  }

  // Prose offer: only when it is the reply's last sentence.
  const last = lines[lines.length - 1];
  const sentences = last.trim().split(/(?<=[.?!])\s+/);
  const offer = sentences[sentences.length - 1];
  if (!sameItems(parseProseOfferLine(offer).slice(0, 3), items)) return keep;
  const rest = sentences.slice(0, -1).join(' ');
  const body = [...lines.slice(0, -1), ...(rest ? [rest] : [])].join('\n').trimEnd();
  return body.trim() ? { body, items } : keep;
}
