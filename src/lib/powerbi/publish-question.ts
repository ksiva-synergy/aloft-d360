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
