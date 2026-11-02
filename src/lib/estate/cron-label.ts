const DAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const DAY_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const pad = (n: number) => String(n).padStart(2, '0');
const isInt = (s: string) => /^\d+$/.test(s);

/**
 * Plain-language label for a 5-field cron (minute hour day-of-month month day-of-week), in UTC.
 * Covers the shapes our harvest schedules use; anything else returns "Custom schedule".
 */
export function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return 'Custom schedule';
  const [min, hour, dom, month, dow] = parts;
  const anyDay = (dom === '*' || dom === '?') && month === '*';

  const everyHours = /^\*\/(\d+)$/.exec(hour);
  if (isInt(min) && everyHours && anyDay && (dow === '*' || dow === '?')) {
    const n = Number(everyHours[1]);
    return n === 1 ? 'Every hour' : `Every ${n} hours`;
  }
  if (isInt(min) && hour === '*' && anyDay && (dow === '*' || dow === '?')) return 'Every hour';

  if (!isInt(min) || !isInt(hour)) return 'Custom schedule';
  const at = `${pad(Number(hour))}:${pad(Number(min))} UTC`;

  if (anyDay && (dow === '*' || dow === '?')) return `Daily at ${at}`;
  if (anyDay && /^[0-7]$/.test(dow)) return `${DAY_NAMES[Number(dow) % 7]} at ${at}`;
  if (anyDay && DAY_ABBR.includes(dow.toUpperCase())) return `${DAY_NAMES[DAY_ABBR.indexOf(dow.toUpperCase())]} at ${at}`;
  if (anyDay && (dow === '1-5' || dow.toUpperCase() === 'MON-FRI')) return `Weekdays at ${at}`;
  if (isInt(dom) && month === '*' && (dow === '*' || dow === '?')) return `Monthly on day ${Number(dom)} at ${at}`;
  return 'Custom schedule';
}
