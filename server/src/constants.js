// SQLite has no native enum type, so these values are enforced in application
// code instead of the database schema.
module.exports = {
  TRIGGER_TYPES: ['WEBHOOK', 'SCHEDULE', 'MANUAL'],
  ACTION_TYPES: ['HTTP_REQUEST', 'TRANSFORM', 'DELAY', 'LOG'],
  RUN_STATUSES: ['SUCCESS', 'FAILED', 'RUNNING'],
  STEP_STATUSES: ['SUCCESS', 'FAILED', 'SKIPPED'],

  // Hard server-side bounds — never trust client input for these.
  MAX_DELAY_SECONDS: 10,
  MIN_CRON_INTERVAL_MINUTES: 5,
  MAX_ACTIVE_SCHEDULE_WORKFLOWS: 10,
  MAX_RUNS_PER_WORKFLOW_PER_HOUR: 30,
  HTTP_REQUEST_TIMEOUT_MS: 5000,
  HTTP_MAX_RESPONSE_BYTES: 1024 * 1024, // 1MB
  STORED_RESPONSE_BODY_CAP: 2048, // ~2KB
};
