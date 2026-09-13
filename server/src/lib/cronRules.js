const cron = require('node-cron');
const { MIN_CRON_INTERVAL_MINUTES } = require('../constants');

/**
 * Estimates the shortest gap (in minutes) between consecutive firings implied
 * by a 5-field cron expression's minute field. This is a deliberately
 * conservative heuristic (not a full cron-semantics simulator) — good enough
 * to bound background load on a shared public demo deployment without
 * pulling in a full cron-parsing library.
 */
function estimateMinIntervalMinutes(minuteField) {
  if (minuteField === '*') return 1;

  const step = minuteField.match(/^\*\/(\d+)$/);
  if (step) return Math.max(1, parseInt(step[1], 10));

  if (minuteField.includes(',')) {
    const values = minuteField
      .split(',')
      .map((v) => parseInt(v, 10))
      .filter((v) => !Number.isNaN(v))
      .sort((a, b) => a - b);
    if (values.length < 2) return 60;
    let minGap = 60;
    for (let i = 1; i < values.length; i++) {
      minGap = Math.min(minGap, values[i] - values[i - 1]);
    }
    minGap = Math.min(minGap, 60 - values[values.length - 1] + values[0]);
    return minGap;
  }

  if (minuteField.includes('-')) {
    // A bare range (e.g. "0-30") with no step fires every minute in range.
    return 1;
  }

  // A single fixed minute (e.g. "0") fires at most once per hour (assuming
  // the hour field doesn't narrow it further, which would only ever
  // *lengthen* the interval).
  return 60;
}

/**
 * Validates a cron expression is syntactically valid AND fires no more often
 * than MIN_CRON_INTERVAL_MINUTES. Throws a descriptive Error otherwise.
 * Never trust client input here — this runs server-side on every
 * create/update of a SCHEDULE workflow, regardless of what the UI already
 * enforced.
 */
function assertValidCronInterval(expression) {
  if (!expression || typeof expression !== 'string') {
    throw new Error('cronExpression is required for SCHEDULE workflows');
  }
  if (!cron.validate(expression)) {
    throw new Error(`"${expression}" is not a valid cron expression`);
  }
  const [minuteField] = expression.trim().split(/\s+/);
  const minInterval = estimateMinIntervalMinutes(minuteField);
  if (minInterval < MIN_CRON_INTERVAL_MINUTES) {
    throw new Error(
      `Cron expression "${expression}" fires more often than the minimum allowed interval of ${MIN_CRON_INTERVAL_MINUTES} minutes`
    );
  }
}

module.exports = { assertValidCronInterval, estimateMinIntervalMinutes };
