import 'server-only';

import prisma from '@/lib/db';
import { getDefaultOrg } from '@/lib/platform/agents';

export type DatabricksConnectionRow = {
  id: string;
  org_id: string;
  name: string;
  workspace_host: string;
  auth_type: string;
  secret_ref: string;
  default_warehouse_id: string;
  default_warehouse_http_path: string | null;
  genie_space_ids: unknown;
  status: string;
  last_tested_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type CreateConnectionInput = {
  name: string;
  workspace_host: string;
  default_warehouse_id: string;
  default_warehouse_http_path?: string | null;
};

export type UpdateConnectionInput = Partial<CreateConnectionInput> & {
  secret_ref?: string;
  status?: string;
  last_tested_at?: Date | null;
};

export async function getOrgId(): Promise<string> {
  const org = await getDefaultOrg();
  return org.id;
}

export async function listConnections(orgId: string): Promise<DatabricksConnectionRow[]> {
  return prisma.platformDatabricksConnection.findMany({
    where: { org_id: orgId },
    orderBy: { created_at: 'desc' },
  });
}

export async function getConnection(
  orgId: string,
  id: string,
): Promise<DatabricksConnectionRow | null> {
  return prisma.platformDatabricksConnection.findFirst({
    where: { id, org_id: orgId },
  });
}

export async function createConnection(
  orgId: string,
  data: CreateConnectionInput,
): Promise<DatabricksConnectionRow> {
  return prisma.platformDatabricksConnection.create({
    data: {
      org_id: orgId,
      name: data.name,
      workspace_host: data.workspace_host,
      auth_type: 'oauth_m2m',
      secret_ref: '', // filled after Secrets Manager write
      default_warehouse_id: data.default_warehouse_id,
      default_warehouse_http_path: data.default_warehouse_http_path ?? null,
      status: 'untested',
    },
  });
}

export async function updateConnection(
  orgId: string,
  id: string,
  data: UpdateConnectionInput,
): Promise<DatabricksConnectionRow> {
  return prisma.platformDatabricksConnection.update({
    where: { id, org_id: orgId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.workspace_host !== undefined && { workspace_host: data.workspace_host }),
      ...(data.default_warehouse_id !== undefined && { default_warehouse_id: data.default_warehouse_id }),
      ...(data.default_warehouse_http_path !== undefined && { default_warehouse_http_path: data.default_warehouse_http_path }),
      ...(data.secret_ref !== undefined && { secret_ref: data.secret_ref }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.last_tested_at !== undefined && { last_tested_at: data.last_tested_at }),
    },
  });
}

export async function deleteConnection(orgId: string, id: string): Promise<void> {
  await prisma.platformDatabricksConnection.delete({
    where: { id, org_id: orgId },
  });
}
