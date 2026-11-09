/** Split free-text purpose into search phrases (lists, "and", newlines). */
export function purposePhrases(text: string): string[] {
  const raw = text
    .split(/\n|;|•|·/)
    .flatMap((line) => line.split(/\s+and\s+/i))
    .map((s) => s.replace(/^[-*]\s*/, '').trim())
    .filter((s) => s.length >= 4);
  const uniq = [...new Set(raw)];
  if (uniq.length === 0 && text.trim().length >= 4) return [text.trim()];
  return uniq.slice(0, 5);
}
