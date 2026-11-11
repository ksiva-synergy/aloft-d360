import 'server-only';

/** Power BI app registration from environment (values never logged). */
export function getPowerBiCredentials(): {
  tenantId: string;
  clientId: string;
  clientSecret: string;
} | null {
  const tenantId = process.env.PBI_TENANT_ID?.trim() ?? '';
  const clientId = process.env.PBI_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.PBI_CLIENT_SECRET?.trim() ?? '';
  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret };
}
