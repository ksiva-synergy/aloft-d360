/**
 * Launch context-harvester workers via ECS Fargate or a local detached process.
 *
 * HARVEST_RUNTIME=local  → spawn orchestrator on this machine (local/dev only)
 * HARVEST_RUNTIME=ecs    → ECS RunTask (default; production / staging)
 */

import { spawn } from 'node:child_process';
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import { ecsRuntimeConfig, isLocalHarvestRuntime } from '@/lib/aws/ecs-runtime-config';

export { isLocalHarvestRuntime };

/** Orchestrator argv used by Fargate containerOverrides and local spawn. */
export const HARVEST_ORCHESTRATOR_COMMAND = [
  'npx',
  'tsx',
  '--require',
  './scripts/context/noserver.cjs',
  'scripts/context/orchestrator.ts',
] as const;

export type LaunchHarvesterResult = {
  /** Short id stored on job.scope.fargate_task_id (ECS task id or local-<pid>). */
  taskId: string | null;
  /** Full ARN when ECS; `local://<pid>` when local. */
  taskArn: string | null;
  error?: string;
};

/**
 * Start a harvester worker with the given orchestrator flags
 * (e.g. `['--kind', 't0_structural']` or `['--kind', 't2_semantic', '--child-job', id]`).
 */
export async function launchHarvesterTask(
  extraArgs: string[],
): Promise<LaunchHarvesterResult> {
  if (isLocalHarvestRuntime()) {
    return launchLocal(extraArgs);
  }
  return launchEcs(extraArgs);
}

function launchLocal(extraArgs: string[]): LaunchHarvesterResult {
  const args = [...HARVEST_ORCHESTRATOR_COMMAND.slice(1), ...extraArgs];
  try {
    const child = spawn(HARVEST_ORCHESTRATOR_COMMAND[0], args, {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      env: process.env,
      // Windows needs a shell to resolve npx.cmd
      shell: process.platform === 'win32',
    });
    child.unref();

    const pid = child.pid;
    if (!pid) {
      return {
        taskId: null,
        taskArn: null,
        error: 'Failed to spawn local harvester (no pid)',
      };
    }

    const taskId = `local-${pid}`;
    console.log(
      `[harvest-runtime] local spawn pid=${pid} args=${extraArgs.join(' ')}`,
    );
    return { taskId, taskArn: `local://${pid}` };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[harvest-runtime] local spawn failed: ${error}`);
    return { taskId: null, taskArn: null, error };
  }
}

async function launchEcs(extraArgs: string[]): Promise<LaunchHarvesterResult> {
  const {
    region,
    cluster,
    taskDefinition,
    containerName,
    subnets,
    securityGroups,
    assignPublicIp,
  } = ecsRuntimeConfig;

  try {
    const ecs = new ECSClient({ region });
    const result = await ecs.send(
      new RunTaskCommand({
        cluster,
        taskDefinition,
        launchType: 'FARGATE',
        count: 1,
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets,
            securityGroups,
            assignPublicIp,
          },
        },
        overrides: {
          containerOverrides: [
            {
              name: containerName,
              command: [...HARVEST_ORCHESTRATOR_COMMAND, ...extraArgs],
            },
          ],
        },
      }),
    );

    const failure = result.failures?.[0];
    if (failure) {
      return {
        taskId: null,
        taskArn: null,
        error: failure.reason ?? 'ECS RunTask failure',
      };
    }

    const taskArn = result.tasks?.[0]?.taskArn ?? null;
    const taskId = taskArn ? (taskArn.split('/').pop() ?? null) : null;
    return { taskId, taskArn };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[harvest-runtime] ECS RunTask failed: ${error}`);
    return { taskId: null, taskArn: null, error };
  }
}
