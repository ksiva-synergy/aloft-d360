/**
 * Databricks test-connection routine.
 *
 * Acquires an OAuth token, runs `SELECT 1` via the Databricks Statement
 * Execution API, and updates the connection row's status + last_tested_at.
 * Never logs the token or any credential value.
 */

import { getAccessToken } from './token-client';
import prisma from '@/lib/db';

export interface TestConnectionResult {
  success: boolean;
  status: 'active' | 'error';
  testedAt: Date;
  errorMessage?: string;
}

// Maximum time Databricks will wait before returning PENDING (we want a quick pass/fail)
const WAIT_TIMEOUT = '10s';

export async function testConnection(connectionId: string): Promise<TestConnectionResult> {
  const connection = await prisma.platformDatabricksConnection.findUnique({
    where: { id: connectionId },
    select: {
      id: true,
      workspace_host: true,
      default_warehouse_id: true,
    },
  });

  if (!connection) {
    throw new Error(`Connection ${connectionId} not found`);
  }

  const testedAt = new Date();
  let success = false;
  let errorMessage: string | undefined;

  try {
    const token = await getAccessToken(connectionId, connection.workspace_host);
    await runSelectOne(connection.workspace_host, connection.default_warehouse_id, token);
    success = true;
  } catch (err: unknown) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  const newStatus = success ? 'active' : 'error';

  await prisma.platformDatabricksConnection.update({
    where: { id: connectionId },
    data: {
      status: newStatus,
      last_tested_at: testedAt,
    },
  });

  return { success, status: newStatus, testedAt, errorMessage };
}

async function runSelectOne(
  workspaceHost: string,
  warehouseId: string,
  token: string,
): Promise<void> {
  const host = workspaceHost.replace(/^https?:\/\//, '');
  const url = `https://${host}/api/2.0/sql/statements`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        statement: 'SELECT 1',
        warehouse_id: warehouseId,
        wait_timeout: WAIT_TIMEOUT,
        on_wait_timeout: 'CANCEL',
      }),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    throw new Error(
      isAbort
        ? `Databricks host '${host}' did not respond within 15 s — check network connectivity or firewall rules`
        : `Network error reaching Databricks host '${host}': ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '(no body)');
    throw new Error(`Statement execution returned ${resp.status}: ${errText}`);
  }

  const result = await resp.json() as {
    status: { state: string; error?: { message: string } };
  };

  const state = result.status?.state;

  if (state === 'FAILED' || state === 'CANCELED') {
    const msg = result.status?.error?.message ?? state;
    throw new Error(`Query ${state}: ${msg}`);
  }

  // SUCCEEDED or CLOSED both indicate the warehouse responded — connection is good
  if (state !== 'SUCCEEDED' && state !== 'CLOSED') {
    throw new Error(`Unexpected statement state: ${state}`);
  }
}
