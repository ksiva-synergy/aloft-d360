/** Build a single-cell DAX query for a measure (oracle v1). */
export function buildMeasureOracleQuery(measureName: string): string {
  const escaped = measureName.replace(/]/g, ']]');
  return `EVALUATE ROW("Value", [${escaped}])`;
}
