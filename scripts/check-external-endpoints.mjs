/**
 * Smoke-test external dependencies (no secrets printed).
 * Usage: node scripts/check-external-endpoints.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(path.join(root, '.env'));
loadEnvFile(path.join(root, '.env.local'));

const results = [];

/** Probes that are expected to fail (legacy host) — do not fail the process exit code. */
const NON_BLOCKING = new Set([
  'Azure OpenAI legacy crewai (DNS)',
  'Bedrock Mantle (models)',
]);

function awsCredentials() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) throw new Error('AWS keys not set');
  return { accessKeyId, secretAccessKey };
}

function awsRegion() {
  return process.env.AWS_REGION || 'ap-south-1';
}

function recordSkip(name, category, detail) {
  results.push({ name, category, status: 'skip', ms: 0, detail });
}

async function record(name, category, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({
      name,
      category,
      status: 'ok',
      ms: Date.now() - started,
      detail: detail ?? '',
    });
  } catch (err) {
    results.push({
      name,
      category,
      status: 'fail',
      ms: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function dnsOk(hostname) {
  await dns.lookup(hostname);
  return `resolved ${hostname}`;
}

async function fetchProbe(url, init, expectStatuses) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(25_000) });
  const ok = expectStatuses.includes(res.status);
  if (!ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${body.slice(0, 120)}`);
  }
  return `HTTP ${res.status}`;
}

async function main() {
  const tenant = process.env.AZURE_AD_TENANT_ID;

  await record('Azure AD OIDC metadata', 'auth', async () => {
    if (!tenant) throw new Error('AZURE_AD_TENANT_ID not set');
    const url = `https://login.microsoftonline.com/${tenant}/v2.0/.well-known/openid-configuration`;
    return fetchProbe(url, {}, [200]);
  });

  await record('xAI API (models list)', 'llm', async () => {
    const key = process.env.XAI_API_KEY;
    if (!key) throw new Error('XAI_API_KEY not set');
    const base = (process.env.XAI_BASE_URL || 'https://api.x.ai/v1').replace(/\/$/, '');
    return fetchProbe(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } }, [200]);
  });

  await record('Azure AI Foundry (DNS)', 'llm', async () => {
    const ep = process.env.FOUNDRY_ENDPOINT;
    if (!ep) throw new Error('FOUNDRY_ENDPOINT not set');
    const h = hostFromUrl(ep);
    if (!h) throw new Error('invalid FOUNDRY_ENDPOINT');
    return dnsOk(h);
  });

  await record('Azure AI Foundry (models)', 'llm', async () => {
    const key = process.env.FOUNDRY_API_KEY;
    const ep = process.env.FOUNDRY_ENDPOINT;
    if (!key || !ep) throw new Error('FOUNDRY_* not set');
    const base = ep.replace(/\/$/, '');
    return fetchProbe(
      `${base}/openai/v1/models`,
      { headers: { 'api-key': key } },
      [200, 401, 403, 404],
    );
  });

  await record('Azure OpenAI legacy crewai (DNS)', 'llm', async () => {
    const ep = process.env.AZURE_OPENAI_ENDPOINT;
    if (!ep) throw new Error('AZURE_OPENAI_ENDPOINT not set');
    const h = hostFromUrl(ep);
    if (!h) throw new Error('invalid endpoint');
    return dnsOk(h);
  });

  await record('Azure embeddings host (DNS)', 'embedding', async () => {
    const ep =
      process.env.FOUNDRY_EMBEDDING_ENDPOINT ||
      process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT ||
      process.env.FOUNDRY_ENDPOINT;
    if (!ep) throw new Error('no embedding endpoint env');
    const h = hostFromUrl(ep);
    if (!h) throw new Error('invalid endpoint');
    return dnsOk(h);
  });

  await record('Azure embeddings (minimal)', 'embedding', async () => {
    const model =
      process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT ||
      process.env.FOUNDRY_EMBEDDING_DEPLOYMENT ||
      'text-embedding-3-large';
    const apiKey = process.env.FOUNDRY_API_KEY || process.env.AZURE_OPENAI_API_KEY;
    const ep =
      process.env.FOUNDRY_EMBEDDING_ENDPOINT ||
      process.env.FOUNDRY_ENDPOINT ||
      process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT ||
      process.env.AZURE_OPENAI_ENDPOINT;
    if (!apiKey || !ep) throw new Error('embedding credentials missing');
    const base = ep.replace(/\/$/, '');
    const url = `${base}/openai/deployments/${model}/embeddings?api-version=${
      process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview'
    }`;
    return fetchProbe(
      url,
      {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: 'ping', dimensions: 1024 }),
      },
      [200, 400, 401, 403, 404],
    );
  });

  await record('Databricks workspace (DNS)', 'data', async () => {
    const host = process.env.DATABRICKS_HOST || process.env.DATABRICKS_SERVER_HOSTNAME;
    if (!host) throw new Error('DATABRICKS_HOST not set');
    const h = host.replace(/^https?:\/\//, '').split('/')[0];
    return dnsOk(h);
  });

  await record('Databricks SQL warehouse (SELECT 1)', 'data', async () => {
    const host = (process.env.DATABRICKS_HOST || process.env.DATABRICKS_SERVER_HOSTNAME || '')
      .replace(/^https?:\/\//, '')
      .split('/')[0];
    const httpPath = process.env.DATABRICKS_HTTP_PATH || '';
    const warehouseId = httpPath.match(/warehouses\/([^/]+)/)?.[1];
    const id = process.env.DATABRICKS_CLIENT_ID;
    const secret = process.env.DATABRICKS_CLIENT_SECRET;
    if (!host || !warehouseId || !id || !secret) {
      throw new Error('DATABRICKS_HOST, DATABRICKS_HTTP_PATH, client id/secret required');
    }
    const tokenBody = new URLSearchParams({ grant_type: 'client_credentials', scope: 'all-apis' });
    const tokenRes = await fetch(`https://${host}/oidc/v1/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      },
      body: tokenBody,
      signal: AbortSignal.timeout(25_000),
    });
    if (!tokenRes.ok) throw new Error(`token HTTP ${tokenRes.status}`);
    const { access_token: token } = await tokenRes.json();
    const sqlRes = await fetch(`https://${host}/api/2.0/sql/statements`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        statement: 'SELECT 1 AS ok',
        warehouse_id: warehouseId,
        wait_timeout: '30s',
        on_wait_timeout: 'CANCEL',
        format: 'JSON_ARRAY',
        disposition: 'INLINE',
        row_limit: 1,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!sqlRes.ok) {
      const t = await sqlRes.text().catch(() => '');
      throw new Error(`statements HTTP ${sqlRes.status}: ${t.slice(0, 120)}`);
    }
    const raw = await sqlRes.json();
    if (raw.status?.state !== 'SUCCEEDED') {
      throw new Error(`statement state ${raw.status?.state ?? 'unknown'}`);
    }
    return `warehouse ${warehouseId} SUCCEEDED`;
  });

  await record('Databricks OAuth token', 'data', async () => {
    const host = (process.env.DATABRICKS_HOST || process.env.DATABRICKS_SERVER_HOSTNAME || '').replace(
      /^https?:\/\//,
      '',
    );
    const id = process.env.DATABRICKS_CLIENT_ID;
    const secret = process.env.DATABRICKS_CLIENT_SECRET;
    if (!host || !id || !secret) throw new Error('Databricks OAuth env incomplete');
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'all-apis',
    });
    return fetchProbe(
      `https://${host}/oidc/v1/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
        },
        body,
      },
      [200],
    );
  });

  await record('ECS cluster (describe)', 'aws', async () => {
    const { ECSClient, DescribeClustersCommand } = await import('@aws-sdk/client-ecs');
    const cluster = process.env.ECS_CLUSTER_NAME || 'aloft-agents-prod';
    const ecs = new ECSClient({ region: awsRegion(), credentials: awsCredentials() });
    const out = await ecs.send(new DescribeClustersCommand({ clusters: [cluster] }));
    const c = out.clusters?.[0];
    if (!c?.clusterArn) {
      const reason = out.failures?.[0]?.reason ?? 'cluster not found';
      throw new Error(`${cluster}: ${reason}`);
    }
    return `${cluster} status=${c.status} runningTasks=${c.runningTasksCount ?? 0}`;
  });

  await record('ECS context task definition (describe)', 'aws', async () => {
    const { ECSClient, DescribeTaskDefinitionCommand } = await import('@aws-sdk/client-ecs');
    const taskDef = process.env.ECS_CONTEXT_TASK_DEFINITION || 'aloft-context-harvester';
    const ecs = new ECSClient({ region: awsRegion(), credentials: awsCredentials() });
    const out = await ecs.send(new DescribeTaskDefinitionCommand({ taskDefinition: taskDef }));
    const arn = out.taskDefinition?.taskDefinitionArn;
    if (!arn) throw new Error(`task definition ${taskDef} not found`);
    return `${taskDef} revision ${out.taskDefinition?.revision ?? '?'}`;
  });

  await record('Secrets Manager (list aloft/*)', 'aws', async () => {
    const { SecretsManagerClient, ListSecretsCommand } = await import(
      '@aws-sdk/client-secrets-manager'
    );
    const client = new SecretsManagerClient({
      region: awsRegion(),
      credentials: awsCredentials(),
    });
    const out = await client.send(
      new ListSecretsCommand({
        MaxResults: 10,
        Filters: [{ Key: 'name', Values: ['aloft'] }],
      }),
    );
    const n = out.SecretList?.length ?? 0;
    return `ListSecrets ok (${n} secret(s) matched filter)`;
  });

  await record('S3 backfill bucket (HeadBucket)', 'aws', async () => {
    const bucket = process.env.BACKFILL_S3_BUCKET;
    if (!bucket) throw new Error('BACKFILL_S3_BUCKET not set');
    const region = process.env.BACKFILL_S3_REGION || awsRegion();
    const { S3Client, HeadBucketCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({ region, credentials: awsCredentials() });
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return `bucket ${bucket} in ${region}`;
  });

  await record('S3 browse bucket (HeadBucket)', 'aws', async () => {
    const bucket = process.env.BACKFILL_S3_BROWSE_BUCKET || process.env.BACKFILL_S3_BUCKET;
    if (!bucket) throw new Error('BACKFILL_S3_BROWSE_BUCKET / BACKFILL_S3_BUCKET not set');
    const region =
      process.env.BACKFILL_S3_BROWSE_REGION || process.env.BACKFILL_S3_REGION || awsRegion();
    const { S3Client, HeadBucketCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({ region, credentials: awsCredentials() });
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return `bucket ${bucket} in ${region}`;
  });

  await record('CloudWatch Logs (describe)', 'aws', async () => {
    const { CloudWatchLogsClient, DescribeLogGroupsCommand } = await import(
      '@aws-sdk/client-cloudwatch-logs'
    );
    const client = new CloudWatchLogsClient({
      region: awsRegion(),
      credentials: awsCredentials(),
    });
    const out = await client.send(new DescribeLogGroupsCommand({ limit: 1 }));
    const n = out.logGroups?.length ?? 0;
    return `API ok (${n} log group(s) in first page)`;
  });

  const pbcUrl = (process.env.PBC_PROMOTION_API_URL || '').trim();
  if (!pbcUrl) {
    recordSkip('PBC Promotion API', 'integration', 'PBC_PROMOTION_API_URL not set — skip');
  } else {
    await record('PBC Promotion API', 'integration', async () => {
      const base = pbcUrl.replace(/\/$/, '');
      return fetchProbe(base, {}, [200, 401, 403, 404, 405]);
    });
  }

  await record('PostgreSQL (RDS query)', 'database', async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(
      'npx',
      ['prisma', 'db', 'execute', '--stdin', '--schema=prisma/schema.prisma'],
      {
        cwd: root,
        input: 'SELECT 1 AS ok;',
        encoding: 'utf8',
        shell: true,
        timeout: 60_000,
      },
    );
    if (r.status !== 0) {
      throw new Error((r.stderr || r.stdout || 'prisma db execute failed').trim().slice(0, 200));
    }
    const m = process.env.DATABASE_URL.match(/@([^:/]+)/);
    const h = m?.[1] ?? 'unknown-host';
    return `SELECT 1 ok via Prisma (${h}:5432)`;
  });

  await record('Bedrock Mantle (models)', 'llm', async () => {
    const key = process.env.BEDROCK_MANTLE_API_KEY;
    if (!key) throw new Error('BEDROCK_MANTLE_API_KEY not set (skipped in summary if optional)');
    const region = process.env.BEDROCK_MANTLE_REGION ?? 'us-east-2';
    const base = `https://bedrock-mantle.${region}.api.aws/openai/v1`;
    return fetchProbe(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } }, [
      200,
      401,
      403,
      404,
    ]);
  });

  await record('AWS Bedrock (Titan embed probe)', 'llm', async () => {
    const id = process.env.AWS_ACCESS_KEY_ID;
    const secret = process.env.AWS_SECRET_ACCESS_KEY;
    if (!id || !secret) throw new Error('AWS keys not set');
    const { BedrockRuntimeClient, InvokeModelCommand } = await import(
      '@aws-sdk/client-bedrock-runtime'
    );
    const region = process.env.AWS_REGION || 'us-east-1';
    const client = new BedrockRuntimeClient({
      region,
      credentials: { accessKeyId: id, secretAccessKey: secret },
    });
    await client.send(
      new InvokeModelCommand({
        modelId: 'amazon.titan-embed-text-v2:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({ inputText: 'ping', dimensions: 8, normalize: true }),
      }),
    );
    return `region ${region}`;
  });

  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
  const localRoutes = [
    { name: 'NextAuth providers', path: '/api/auth/providers' },
    { name: 'Studio insights (auth gate)', path: '/api/agent-lab/studio/insights' },
    { name: 'Inspector chat (auth gate)', path: '/api/inspector/chat' },
    { name: 'Databricks connections (auth gate)', path: '/api/databricks/connections' },
  ];

  for (const r of localRoutes) {
    await record(`App ${r.name}`, 'app-api', async () => {
      try {
        return await fetchProbe(
          `${baseUrl.replace(/\/$/, '')}${r.path}`,
          { method: r.path.includes('insights') ? 'GET' : 'GET' },
          [200, 401, 405, 307, 308],
        );
      } catch (e) {
        if (String(e).includes('fetch failed') || String(e).includes('ECONNREFUSED')) {
          throw new Error(`dev server not reachable at ${baseUrl}`);
        }
        throw e;
      }
    });
  }

  const ok = results.filter((r) => r.status === 'ok').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  const failAll = results.filter((r) => r.status === 'fail');
  const fail = failAll.filter((r) => !NON_BLOCKING.has(r.name));
  const expectedFail = failAll.filter((r) => NON_BLOCKING.has(r.name));
  console.log(
    JSON.stringify(
      {
        summary: {
          ok,
          skip: skipped,
          fail: fail.length,
          expectedFail: expectedFail.length,
          total: results.length,
        },
        results,
      },
      null,
      2,
    ),
  );
  process.exit(fail.length > 0 ? 1 : 0);
}

main();
