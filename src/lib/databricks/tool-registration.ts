/**
 * Databricks tool catalog registration.
 *
 * Each PlatformDatabricksConnection is mirrored as a `tool_catalog` entry of
 * type "db_query". This makes the connection available as an attachable tool
 * in the Agent Lab workbench.
 *
 * The slug `databricks-{connectionId}` acts as the stable join key — no
 * additional column is needed on the connection row.
 */

import prisma from '@/lib/db';
import type { DatabricksConnectionRow } from './connections';

const TOOL_VERSION = '1.0.0';
const TOOL_AUTHOR = 'aloft/databricks';

export function toolSlug(connectionId: string): string {
  return `databricks-${connectionId}`;
}

export async function syncToolEntry(conn: DatabricksConnectionRow): Promise<string> {
  const slug = toolSlug(conn.id);

  const inputSchema = {
    type: 'object',
    properties: {
      statement: {
        type: 'string',
        description: 'SQL statement to execute against the warehouse',
      },
      wait_timeout: {
        type: 'string',
        description: 'Maximum time to wait for results (e.g. "30s"). Defaults to "30s".',
        default: '30s',
      },
    },
    required: ['statement'],
  };

  const outputSchema = {
    type: 'object',
    properties: {
      rows: {
        type: 'array',
        description: 'Result rows as objects keyed by column name',
      },
      row_count: {
        type: 'integer',
        description: 'Number of rows returned',
      },
      columns: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type_name: { type: 'string' },
          },
        },
        description: 'Column metadata from the result set',
      },
    },
  };

  const config = {
    connection_id: conn.id,
    workspace_host: conn.workspace_host,
    warehouse_id: conn.default_warehouse_id,
    http_path: conn.default_warehouse_http_path ?? null,
    execute_url: `/api/databricks/connections/${conn.id}/execute`,
  };

  // Upsert by slug — tool_catalog.id is UUID so we match on slug
  const existing = await prisma.tool_catalog.findFirst({ where: { slug } });

  if (existing) {
    await prisma.tool_catalog.update({
      where: { id: existing.id },
      data: {
        name: `Databricks: ${conn.name}`,
        description: `Full SQL access to ${conn.workspace_host} via OAuth M2M. Executes any statement against warehouse ${conn.default_warehouse_id}.`,
        status: conn.status === 'error' ? 'degraded' : 'active',
        config,
        updated_at: new Date(),
      },
    });
    return existing.id;
  }

  const created = await prisma.tool_catalog.create({
    data: {
      name: `Databricks: ${conn.name}`,
      slug,
      type: 'db_query',
      description: `Full SQL access to ${conn.workspace_host} via OAuth M2M. Executes any statement against warehouse ${conn.default_warehouse_id}.`,
      version: TOOL_VERSION,
      author: TOOL_AUTHOR,
      status: 'active',
      input_schema: inputSchema,
      output_schema: outputSchema,
      config,
      tags: ['databricks', 'sql', 'db_query', 'warehouse'],
    },
  });

  return created.id;
}

export async function deleteToolEntry(connectionId: string): Promise<void> {
  const slug = toolSlug(connectionId);
  const existing = await prisma.tool_catalog.findFirst({ where: { slug } });
  if (existing) {
    await prisma.tool_catalog.delete({ where: { id: existing.id } });
  }
}

export async function getToolEntry(
  connectionId: string,
): Promise<{ id: string; name: string; status: string | null } | null> {
  const slug = toolSlug(connectionId);
  return prisma.tool_catalog.findFirst({
    where: { slug },
    select: { id: true, name: true, status: true },
  });
}
