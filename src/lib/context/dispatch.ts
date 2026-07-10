// Dispatch layer for the describe_schema tool.
// No warehouse access in this file or its callees (listObjects / describeObject are pure Prisma reads).
// getDefaultOrg provides org scoping; no session context is consulted.

import 'server-only';
import { getDefaultOrg } from '@/lib/platform/agents';
import { listObjects, describeObject, profileObject, searchObjects, relationsObject, usageObject } from './describe';

export async function handleDescribeSchema(input: Record<string, unknown>): Promise<string> {
  const action = (input.action as string | undefined) ?? '';
  const connection = (input.connection as string | undefined) ?? '';
  const path = input.path as string | undefined;
  const detail = (input.detail as 'compact' | 'full' | undefined) ?? 'compact';

  if (!connection) {
    return JSON.stringify({ error: "Missing required parameter 'connection'." });
  }

  let orgId: string;
  try {
    const org = await getDefaultOrg();
    orgId = org.id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return JSON.stringify({ error: `Could not resolve org: ${msg}` });
  }

  if (action === 'list') {
    const { resolveConnectionName } = await import('./describe');
    const resolvedConnection = await resolveConnectionName(connection);
    const result = await listObjects({ orgId, connection: resolvedConnection });
    return JSON.stringify(result);
  }

  if (action === 'describe') {
    if (!path) {
      return JSON.stringify({
        error: "Action 'describe' requires a 'path' argument (catalog.schema.table).",
      });
    }
    const result = await describeObject({ orgId, connection, path, detail });
    if (!result) {
      return JSON.stringify({
        error: `Object not found: '${path}'. Use action:'list' to see available objects for this connection.`,
      });
    }
    return JSON.stringify(result);
  }

  if (action === 'profile') {
    if (!path) {
      return JSON.stringify({
        error: "Action 'profile' requires a 'path' argument (catalog.schema.table).",
      });
    }
    const result = await profileObject({ orgId, connection, path });
    if (!result) {
      return JSON.stringify({
        error: `Object not found: '${path}'. Use action:'list' to see available objects for this connection.`,
      });
    }
    return JSON.stringify(result);
  }

  if (action === 'search') {
    const query = (input.query as string | undefined)?.trim();
    if (!query) {
      return JSON.stringify({
        error: "Action 'search' requires a 'query' parameter (free-text natural language query).",
      });
    }
    const k = typeof input.k === 'number' ? input.k : 5;
    const result = await searchObjects({ orgId, query, k });
    return JSON.stringify(result);
  }

  if (action === 'relations') {
    if (!path) {
      return JSON.stringify({
        error: "Action 'relations' requires a 'path' argument (catalog.schema.table).",
      });
    }
    const result = await relationsObject({ orgId, connection, path });
    if (!result) {
      return JSON.stringify({
        error: `Object not found: '${path}'. Use action:'list' to see available objects for this connection.`,
      });
    }
    return JSON.stringify(result);
  }

  if (action === 'usage') {
    if (!path) {
      return JSON.stringify({
        error: "Action 'usage' requires a 'path' argument (catalog.schema.table).",
      });
    }
    const result = await usageObject(path, orgId);
    if (!result) {
      return JSON.stringify({
        error: `No usage data for: '${path}'. The object may not exist or T3 harvest has not run for it.`,
      });
    }
    return JSON.stringify({ action: 'usage', ...result });
  }

  return JSON.stringify({
    error: `Unknown action: '${action}'. Available actions: list, describe, profile, search, relations, usage.`,
    available_actions: ['list', 'describe', 'profile', 'search', 'relations', 'usage'],
  });
}
