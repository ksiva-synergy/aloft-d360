import CronParser from 'cron-parser';
import eventBridgeRules from '../../../infra/context/eventbridge-rule.json';

/**
 * Whether the schedule is actually wired to a deployed EventBridge rule.
 * - 'live'   → an EventBridge rule exists and fires on the cron cadence.
 * - 'manual' → defined here (and launchable on demand) but NOT deployed to
 *              EventBridge, so it does not run automatically.
 */
export type ScheduleDeployment = 'live' | 'manual';

export interface ScheduleDefinition {
  id: string;
  name: string;
  label: string;
  description: string;
  /** EventBridge cron expression e.g. "cron(0 4 * * ? *)" */
  scheduleExpression: string;
  /** AWS cron inner string e.g. "0 4 * * ? *" */
  cronInner: string;
  /** Standard 5-field cron for cron-parser e.g. "0 4 * * *" */
  cronStandard: string;
  trigger: 'scheduled';
  state: string;
  /**
   * Deployment status. Only 'live' schedules run automatically; 'manual' ones are
   * listed and launchable but have no deployed EventBridge rule. This is asserted
   * per-entry here rather than derived from eventbridge-rule.json (which still
   * lists all definitions) — the JSON is the source-of-record for the rule shape,
   * not for what is actually deployed.
   */
  deployment: ScheduleDeployment;
}

/** Strip the AWS "cron(...)" wrapper and convert AWS 7-field to standard 5-field cron */
function awsCronToStandard(awsExpr: string): string {
  const inner = awsExpr.replace(/^cron\(/, '').replace(/\)$/, '');
  // AWS cron: minute hour day-of-month month day-of-week year
  // Standard cron: minute hour day-of-month month day-of-week
  const parts = inner.split(' ');
  if (parts.length === 6) {
    // Remove the "year" field (last) and convert AWS "?" wildcard → "*"
    const std = parts.slice(0, 5).map(p => (p === '?' ? '*' : p));
    return std.join(' ');
  }
  // Fallback: return the inner as-is
  return inner;
}

function buildScheduleDef(
  id: string,
  label: string,
  description: string,
  rule: { Name: string; ScheduleExpression: string; State: string },
  deployment: ScheduleDeployment,
): ScheduleDefinition {
  const inner = rule.ScheduleExpression.replace(/^cron\(/, '').replace(/\)$/, '');
  const cronStandard = awsCronToStandard(rule.ScheduleExpression);
  return {
    id,
    name: rule.Name,
    label,
    description,
    scheduleExpression: rule.ScheduleExpression,
    cronInner: inner,
    cronStandard,
    trigger: 'scheduled',
    state: rule.State,
    deployment,
  };
}

export const HARVEST_SCHEDULES: ScheduleDefinition[] = [
  // ── Live: deployed EventBridge rules that fire on their cron cadence ─────────
  buildScheduleDef(
    'change_detect_daily',
    'Daily change-detect',
    'Detects changed tables since last sweep and enqueues T0 structural harvest',
    eventBridgeRules.change_detect_daily,
    'live',
  ),
  buildScheduleDef(
    't1_profile_weekly',
    'Weekly full profile',
    'Full T1 statistical profiling of all objects regardless of change',
    eventBridgeRules.t1_profile_weekly,
    'live',
  ),
  buildScheduleDef(
    'estate_inventory_weekly',
    'Estate Re-inventory',
    'Weekly full re-inventory of the Databricks estate via information_schema (Monday 06:00 UTC)',
    eventBridgeRules.estate_inventory_weekly,
    'live',
  ),
  // ── Manual: defined + launchable on demand, but NO EventBridge rule deployed ──
  // These do NOT run automatically. Kept visible so the cadence they *would* use
  // is documented, but labelled manual so the UI stops asserting a weekly run.
  buildScheduleDef(
    't3_usage_weekly',
    'T3 usage',
    'T3 usage harvest — query history + lineage scan. Manual/on-demand; no EventBridge rule deployed.',
    eventBridgeRules.t3_usage_weekly,
    'manual',
  ),
  buildScheduleDef(
    't4_semantic_weekly',
    'T4 semantic bootstrap',
    'T4 semantic bootstrap — proposes entities, dimensions, and measures for newly-enriched tables. Manual/on-demand; no EventBridge rule deployed.',
    eventBridgeRules.t4_semantic_weekly,
    'manual',
  ),
];

/** Returns the next N upcoming run times for a schedule. Empty for manual (undeployed) schedules. */
export function getNextRuns(schedule: ScheduleDefinition, count = 3): Date[] {
  // Manual schedules have no deployed rule, so there is no automatic next run.
  if (schedule.deployment === 'manual') return [];
  try {
    const interval = CronParser.parse(schedule.cronStandard, {
      currentDate: new Date(),
      tz: 'UTC',
    });
    const runs: Date[] = [];
    for (let i = 0; i < count; i++) {
      runs.push(interval.next().toDate());
    }
    return runs;
  } catch {
    return [];
  }
}

/** Returns the next single upcoming run date for a schedule, or null */
export function getNextRun(schedule: ScheduleDefinition): Date | null {
  const runs = getNextRuns(schedule, 1);
  return runs[0] ?? null;
}

/** Human-readable "in X hours" / "in X days" relative description */
export function relativeNextRun(schedule: ScheduleDefinition): string {
  // Manual schedules are not deployed — never present them with a cadence.
  if (schedule.deployment === 'manual') return 'not scheduled';
  const next = getNextRun(schedule);
  if (!next) return 'unknown';
  const diff = next.getTime() - Date.now();
  if (diff < 0) return 'overdue';
  if (diff < 3_600_000) return `in ${Math.ceil(diff / 60_000)}m`;
  if (diff < 86_400_000) return `in ${Math.ceil(diff / 3_600_000)}h`;
  const days = Math.ceil(diff / 86_400_000);
  return `in ${days}d`;
}
