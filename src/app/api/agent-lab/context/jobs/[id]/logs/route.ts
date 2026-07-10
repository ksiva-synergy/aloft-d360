import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

const REGION = 'ap-south-1';
const LOG_GROUP = '/ecs/aloft-context-harvester';
const POLL_INTERVAL_MS = 2_000;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'completed', 'done']);

function sseResponse(stream: ReadableStream) {
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

function encode(controller: ReadableStreamDefaultController, closed: { v: boolean }, payload: string) {
  if (closed.v) return;
  try {
    controller.enqueue(new TextEncoder().encode(payload));
  } catch {
    closed.v = true;
  }
}

function sendData(controller: ReadableStreamDefaultController, closed: { v: boolean }, data: unknown) {
  encode(controller, closed, `data: ${JSON.stringify(data)}\n\n`);
}

function sendEvent(controller: ReadableStreamDefaultController, closed: { v: boolean }, event: string, data: unknown) {
  encode(controller, closed, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function closeStream(controller: ReadableStreamDefaultController, closed: { v: boolean }) {
  if (closed.v) return;
  closed.v = true;
  try { controller.close(); } catch { /* already closed */ }
}

type LogLine = { ts: number; message: string };

/**
 * Attempt to fetch all log lines from CloudWatch in a single pass (no streaming).
 * Used for cold-fetching logs for completed jobs with no DB cache.
 */
async function fetchAllLogsFromCloudWatch(taskId: string): Promise<LogLine[]> {
  const cwClient = new CloudWatchLogsClient({ region: REGION });
  const logStreamPrefix = `harvester/context-harvester/${taskId}`;
  const allLines: LogLine[] = [];
  let nextToken: string | undefined;

  // Up to 20 pages (~2000 events) to avoid infinite loops
  for (let i = 0; i < 20; i++) {
    const cmd = new FilterLogEventsCommand({
      logGroupName: LOG_GROUP,
      logStreamNamePrefix: logStreamPrefix,
      ...(nextToken ? { nextToken } : {}),
      limit: 100,
    });

    try {
      const result = await cwClient.send(cmd);
      const events = result.events ?? [];
      for (const e of events) {
        allLines.push({ ts: e.timestamp ?? 0, message: e.message ?? '' });
      }
      if (!result.nextToken || result.nextToken === nextToken) break;
      nextToken = result.nextToken;
    } catch {
      break;
    }
  }

  return allLines;
}

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { id } = await params;
  if (!id) return new Response('Bad Request', { status: 400 });

  try {
    const org = await getDefaultOrg();

    const job = await prisma.platformContextJob.findFirst({
      where: { id, org_id: org.id },
      select: { id: true, status: true, scope: true, job_kind: true },
    });

    if (!job) return new Response('Not Found', { status: 404 });

    const scope = job.scope as Record<string, unknown> | null;
    const taskId = scope?.fargate_task_id as string | undefined;
    const isTerminal = TERMINAL_STATUSES.has(job.status);

    // ── Completed job: try DB first, then fall back to cold CloudWatch fetch ──
    if (isTerminal && taskId) {
      // Try DB cache — wrap in try/catch in case the table is missing or connection fails
      let persisted: { lines: unknown; line_count: number } | null = null;
      try {
        persisted = await prisma.platformJobLog.findUnique({
          where: { job_id: id },
          select: { lines: true, line_count: true },
        });
      } catch {
        // Table may not exist yet or DB error — fall through to CloudWatch
      }

      if (persisted) {
        return Response.json({
          type: 'cached',
          lines: persisted.lines as LogLine[],
          line_count: persisted.line_count,
          taskId,
          logGroup: LOG_GROUP,
          logStream: `harvester/context-harvester/${taskId}`,
        });
      }

      // No DB cache — cold fetch from CloudWatch and persist
      const lines = await fetchAllLogsFromCloudWatch(taskId);
      if (lines.length > 0) {
        try {
          await prisma.platformJobLog.upsert({
            where: { job_id: id },
            create: {
              job_id: id,
              org_id: org.id,
              lines: lines as any,
              line_count: lines.length,
            },
            update: {
              lines: lines as any,
              line_count: lines.length,
            },
          });
        } catch {
          // Non-fatal: best-effort persistence
        }
      }

      return Response.json({
        type: 'cached',
        lines,
        line_count: lines.length,
        taskId,
        logGroup: LOG_GROUP,
        logStream: `harvester/context-harvester/${taskId}`,
        note: lines.length === 0
          ? 'No log events found in CloudWatch. The container may not have started, or logs may have expired.'
          : undefined,
      });
    }

    // ── Terminal job with no task ID: explain clearly ──
    if (isTerminal && !taskId) {
      return Response.json({
        type: 'cached',
        lines: [],
        line_count: 0,
        taskId: null,
        logGroup: LOG_GROUP,
        logStream: null,
        note: 'No Fargate task ID recorded for this job. The job may have failed before the container launched.',
      });
    }

    // ── Live job: SSE stream from CloudWatch (falls through below) ──
    return streamLiveJob(id, org.id, job, taskId);
  } catch (err) {
    console.error('[context/jobs/:id/logs GET]', err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      {
        error: 'INTERNAL',
        message,
        suggestion: 'There was a problem fetching logs. Check your database connection or try again.',
      },
      { status: 500 },
    );
  }
}

function streamLiveJob(
  id: string,
  orgId: string,
  job: { id: string; status: string; scope: unknown; job_kind: string },
  taskId: string | undefined,
) {
  // ── Live job: SSE stream from CloudWatch ──
  const closed = { v: false };
  const stream = new ReadableStream({
    async start(controller) {
      if (!taskId) {
        sendEvent(controller, closed, 'error', { message: 'No Fargate task ID found for this job. Logs are only available after the container launches.' });
        closeStream(controller, closed);
        return;
      }

      const cwClient = new CloudWatchLogsClient({ region: REGION });
      const logStreamPrefix = `harvester/context-harvester/${taskId}`;

      let nextToken: string | undefined;
      let lastEventTime: number = Date.now();
      let isLive = !TERMINAL_STATUSES.has(job.status);

      // Accumulate lines so we can persist them on completion
      const accumulatedLines: LogLine[] = [];

      sendData(controller, closed, {
        type: 'meta',
        logGroup: LOG_GROUP,
        logStream: logStreamPrefix,
        taskId,
      });

      const poll = async () => {
        if (closed.v) return;

        let currentStatus = job.status;

        try {
          const fresh = await prisma.platformContextJob.findFirst({
            where: { id: job.id },
            select: { status: true },
          });
          if (fresh) currentStatus = fresh.status;
          isLive = !TERMINAL_STATUSES.has(currentStatus);
        } catch {
          // swallow
        }

        try {
          const cmd = new FilterLogEventsCommand({
            logGroupName: LOG_GROUP,
            logStreamNamePrefix: logStreamPrefix,
            ...(nextToken ? { nextToken } : {}),
            limit: 100,
          });

          const result = await cwClient.send(cmd);
          const events = result.events ?? [];

          if (events.length > 0) {
            lastEventTime = Date.now();
            const newLines: LogLine[] = events.map(e => ({
              ts: e.timestamp ?? 0,
              message: e.message ?? '',
            }));
            accumulatedLines.push(...newLines);
            sendData(controller, closed, {
              type: 'lines',
              lines: newLines,
            });
          }

          if (result.nextToken && result.nextToken !== nextToken) {
            nextToken = result.nextToken;
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes('ResourceNotFoundException')) {
            sendData(controller, closed, { type: 'error', message: msg });
          }
        }

        const idleTimeout = !isLive && Date.now() - lastEventTime > IDLE_TIMEOUT_MS;
        if (idleTimeout || (!isLive && TERMINAL_STATUSES.has(currentStatus))) {
          // Persist logs to DB before closing
          if (accumulatedLines.length > 0) {
            try {
              await prisma.platformJobLog.upsert({
                where: { job_id: id },
                create: {
                  job_id: id,
                  org_id: orgId,
                  lines: accumulatedLines as any,
                  line_count: accumulatedLines.length,
                },
                update: {
                  lines: accumulatedLines as any,
                  line_count: accumulatedLines.length,
                },
              });
            } catch {
              // Non-fatal
            }
          }

          sendEvent(controller, closed, 'done', { status: currentStatus });
          closeStream(controller, closed);
          return;
        }

        if (!closed.v) {
          setTimeout(poll, POLL_INTERVAL_MS);
        }
      };

      setTimeout(poll, 500);
    },
    cancel() {
      closed.v = true;
    },
  });

  return sseResponse(stream);
}
