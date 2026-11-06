/**
 * AWS Secrets Manager helper for Databricks connection credentials.
 *
 * Secrets are stored as JSON { client_id, client_secret } at the path
 * `aloft/databricks/{connectionId}` (the connection's default credential) or
 * `aloft/databricks/{connectionId}/{role}` (a service principal role, see
 * sp-roles.ts). The DB rows store only the secret name (secret_ref) —
 * credentials never touch the DB.
 */

import {
  SecretsManagerClient,
  CreateSecretCommand,
  PutSecretValueCommand,
  GetSecretValueCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager';
import type { DatabricksSpRole } from './sp-roles';

export interface DatabricksCredentials {
  client_id: string;
  client_secret: string;
}

function getClient(): SecretsManagerClient {
  const id = process.env.AWS_ACCESS_KEY_ID;
  const key = process.env.AWS_SECRET_ACCESS_KEY;
  // Without explicit keys the SDK uses its default chain (the ECS task role on Fargate).
  return new SecretsManagerClient({
    region: process.env.AWS_REGION || 'ap-south-1',
    ...(id && key ? { credentials: { accessKeyId: id, secretAccessKey: key } } : {}),
  });
}

export function secretName(connectionId: string, role?: DatabricksSpRole): string {
  return role ? `aloft/databricks/${connectionId}/${role}` : `aloft/databricks/${connectionId}`;
}

/**
 * Write (create or update) credentials for a connection, or for one of its
 * service principal roles when `role` is given.
 * Returns the secret name stored as `secret_ref` on the DB row.
 */
export async function writeCredentials(
  connectionId: string,
  creds: DatabricksCredentials,
  role?: DatabricksSpRole,
): Promise<string> {
  const client = getClient();
  const name = secretName(connectionId, role);
  const secretString = JSON.stringify(creds);

  try {
    await client.send(new PutSecretValueCommand({ SecretId: name, SecretString: secretString }));
  } catch (err: unknown) {
    if (err instanceof ResourceNotFoundException) {
      await client.send(new CreateSecretCommand({ Name: name, SecretString: secretString }));
    } else {
      throw err;
    }
  }

  return name;
}

/**
 * Read credentials for a connection from Secrets Manager.
 * Never logs the returned values.
 */
export async function readCredentials(
  connectionId: string,
  role?: DatabricksSpRole,
): Promise<DatabricksCredentials> {
  const client = getClient();
  const name = secretName(connectionId, role);

  const resp = await client.send(new GetSecretValueCommand({ SecretId: name }));

  if (!resp.SecretString) {
    throw new Error(`Secret ${name} exists but has no SecretString`);
  }

  const parsed = JSON.parse(resp.SecretString) as DatabricksCredentials;

  if (!parsed.client_id || !parsed.client_secret) {
    throw new Error(`Secret ${name} is missing required fields`);
  }

  return parsed;
}
