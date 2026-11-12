/** How many agents one person can pin to their sidebar. */
export const MAX_PINNED_AGENTS = 5;

export type PinnedAgent = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  /** Opens a chat with the agent. */
  useUrl: string;
};

/** Two-letter monogram for the narrow sidebar ("Vessel Portal Desk" → "VP"), so similar agents stay distinguishable. */
export function agentInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
