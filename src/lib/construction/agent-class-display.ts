/** User-facing labels for internal agent class ids (no physicist names in UI). */
export const AGENT_CLASS_DISPLAY: Record<string, { label: string; hint: string }> = {
  feynman: {
    label: 'Compliance & audit',
    hint: 'Checks records against rules and flags gaps',
  },
  fermi: {
    label: 'Forecasting & planning',
    hint: 'Estimates with confidence and stated assumptions',
  },
  grossmann: {
    label: 'Operations',
    hint: 'Multi-step workflows and handoffs',
  },
  rama: {
    label: 'Evidence validation',
    hint: 'Verifies claims against sources and trace',
  },
};

export function labelForAgentClass(classId: string | null | undefined): string | null {
  if (!classId?.trim()) return null;
  const key = classId.trim().toLowerCase();
  return AGENT_CLASS_DISPLAY[key]?.label ?? null;
}

/** True when this id is a known internal class slug (feynman, fermi, …). */
export function isKnownAgentClassId(classId: string): boolean {
  return Object.prototype.hasOwnProperty.call(AGENT_CLASS_DISPLAY, classId.toLowerCase());
}
