import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

// AWS Secrets Manager storage for connection credentials, at `aloft/connections/<id>`. Same pattern
// as src/lib/databricks/secrets.ts: the database keeps only the secret's name. Values are never
// logged or returned to a client.

let client: SecretsManagerClient | null = null;

function getClient(): SecretsManagerClient {
  // Static keys when the server has them (local dev); otherwise the default chain (ECS task role).
  const { AWS_ACCESS_KEY_ID: id, AWS_SECRET_ACCESS_KEY: key } = process.env;
  client ??= new SecretsManagerClient({
    region: process.env.AWS_REGION || 'ap-south-1',
    ...(id && key ? { credentials: { accessKeyId: id, secretAccessKey: key } } : {}),
  });
  return client;
}

export const connectionSecretName = (connectionId: string) => `aloft/connections/${connectionId}`;

/** Creates or replaces the credentials for a connection. Returns the secret name to store. */
export async function writeConnectionSecret(connectionId: string, value: Record<string, string>): Promise<string> {
  const name = connectionSecretName(connectionId);
  const SecretString = JSON.stringify(value);
  try {
    await getClient().send(new PutSecretValueCommand({ SecretId: name, SecretString }));
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
    await getClient().send(new CreateSecretCommand({ Name: name, SecretString, Description: 'ALOFT storage connection credentials' }));
  }
  return name;
}

export async function readConnectionSecret(secretRef: string): Promise<Record<string, string>> {
  const resp = await getClient().send(new GetSecretValueCommand({ SecretId: secretRef }));
  if (!resp.SecretString) throw new Error('The connection credentials are empty');
  return JSON.parse(resp.SecretString) as Record<string, string>;
}

/** Schedules deletion (7-day recovery window), so a mistaken delete can be undone in AWS. */
export async function deleteConnectionSecret(secretRef: string): Promise<void> {
  try {
    await getClient().send(new DeleteSecretCommand({ SecretId: secretRef, RecoveryWindowInDays: 7 }));
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }
}
