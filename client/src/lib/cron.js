// Client-side mirror of the server's cron-interval heuristic (see
// server/src/lib/cronRules.js) — used only to give immediate UI feedback.
// The server re-validates and is the source of truth; never trust this
// alone for enforcement.
export const MIN_CRON_INTERVAL_MINUTES = 5;

export function estimateMinIntervalMinutes(expression) {
  if (!expression) return null;
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute] = parts;

  if (minute === '*') return 1;

  const step = minute.match(/^\*\/(\d+)$/);
  if (step) return Math.max(1, parseInt(step[1], 10));

  if (minute.includes(',')) {
    const values = minute
      .split(',')
      .map((v) => parseInt(v, 10))
      .filter((v) => !Number.isNaN(v))
      .sort((a, b) => a - b);
    if (values.length < 2) return 60;
    let minGap = 60;
    for (let i = 1; i < values.length; i++) minGap = Math.min(minGap, values[i] - values[i - 1]);
    minGap = Math.min(minGap, 60 - values[values.length - 1] + values[0]);
    return minGap;
  }

  if (minute.includes('-')) return 1;

  return 60;
}

export function cronIntervalError(expression) {
  const interval = estimateMinIntervalMinutes(expression);
  if (interval === null) return 'Enter a valid 5-field cron expression (e.g. "*/15 * * * *")';
  if (interval < MIN_CRON_INTERVAL_MINUTES) {
    return `This expression fires more often than every ${MIN_CRON_INTERVAL_MINUTES} minutes — the shared demo requires a minimum ${MIN_CRON_INTERVAL_MINUTES}-minute interval.`;
  }
  return null;
}
