/**
 * ECS/Fargate settings for context harvester + agent runner launches.
 * After AWS resources are recreated, set ECS_* in .env / Vercel — do not rely on legacy subnet/SG IDs.
 *
 * Local dev: set HARVEST_RUNTIME=local in .env.local to spawn the orchestrator
 * on this machine instead of ECS RunTask (Estate Launch / reharvest / chain).
 *
 * See: docs/aws-recreate-and-configuration.md
 */

/** Set ECS_SUBNET_IDS / ECS_SECURITY_GROUP_IDS in prod — no legacy IDs for new account. */
const LEGACY_SUBNETS: string[] = [];
const LEGACY_SECURITY_GROUPS: string[] = [];

function parseCsv(envVal: string | undefined, legacy: string[]): string[] {
  const parsed = (envVal ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : legacy;
}

/** `local` = spawn orchestrator in-process host; anything else (default) = ECS Fargate. */
export function isLocalHarvestRuntime(): boolean {
  return (process.env.HARVEST_RUNTIME ?? 'ecs').trim().toLowerCase() === 'local';
}

export const ecsRuntimeConfig = {
  region: process.env.AWS_REGION ?? 'ap-south-1',
  cluster: process.env.ECS_CLUSTER_NAME ?? 'aloft-agents-dev',
  taskDefinition: process.env.ECS_CONTEXT_TASK_DEFINITION ?? 'aloft-context-harvester',
  containerName: process.env.ECS_CONTEXT_CONTAINER_NAME ?? 'context-harvester',
  subnets: parseCsv(process.env.ECS_SUBNET_IDS, LEGACY_SUBNETS),
  securityGroups: parseCsv(process.env.ECS_SECURITY_GROUP_IDS, LEGACY_SECURITY_GROUPS),
  assignPublicIp: (process.env.ECS_ASSIGN_PUBLIC_IP ?? 'ENABLED') as 'ENABLED' | 'DISABLED',
};
