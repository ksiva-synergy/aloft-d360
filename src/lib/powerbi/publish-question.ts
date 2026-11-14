/**
 * Build steward-facing verified-query questions from Power BI measure metadata.
 */

export function humanizeMeasureName(name: string): string {
  const spaced = name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function buildVerifiedQueryQuestion(measureName: string, modelName?: string | null): string {
  const label = humanizeMeasureName(measureName);
  if (modelName?.trim()) {
    return `What is ${label} (${modelName.trim()})?`;
  }
  return `What is ${label}?`;
}

export function buildAltPhrasings(
  measureName: string,
  modelName?: string | null,
): string[] {
  const label = humanizeMeasureName(measureName);
  const phrases = [
    measureName,
    `Show ${label}`,
    `Total ${label}`,
    `Get ${label}`,
  ];
  if (modelName?.trim()) {
    phrases.push(`${label} in ${modelName.trim()}`);
  }
  return [...new Set(phrases.map(p => p.trim()).filter(Boolean))].slice(0, 7);
}

/** Constant measure (e.g. `= 0`) that exists for its dynamic format string. */
export function isDisplayHelper(measure: { dax?: string | null; props?: unknown } | null | undefined): boolean {
  const fsd = (measure?.props as { tmdl?: { formatStringDefinition?: string } } | null)?.tmdl?.formatStringDefinition;
  const dax = (measure?.dax ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(\/\/|--).*$/gm, '').trim();
  return Boolean(fsd) && /^(-?\d+(\.\d+)?|BLANK\(\)|"[^"]*")$/i.test(dax);
}
