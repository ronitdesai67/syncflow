const prisma = require('../prisma');
const { runWorkflow } = require('./runner');
const { estimateMinIntervalMinutes } = require('./cronRules');
const { RateLimitedError } = require('./runner');

/**
 * Serverless replacement for the long-lived node-cron scheduler.
 *
 * On a server that stays up, node-cron holds a timer per SCHEDULE workflow
 * (see scheduler.js). Vercel has no such process — a function exists only for
 * the length of one request — so in production Vercel Cron pokes
 * /api/cron/tick instead, and this decides which workflows are *due*.
 *
 * "Due" is derived from the same conservative minute-field heuristic the
 * create/update validator already uses (cronRules.js): a workflow is due when
 * the gap since its last SCHEDULE run is at least its cron expression's
 * shortest possible interval. That deliberately under-fires rather than
 * over-fires — a workflow never runs more often than its expression allows,
 * which is the direction a shared public demo should err in.
 */
async function runDueScheduledWorkflows({ now = new Date() } = {}) {
  const workflows = await prisma.workflow.findMany({
    where: { triggerType: 'SCHEDULE', isActive: true },
    include: { steps: true },
  });

  const results = [];

  for (const workflow of workflows) {
    if (!workflow.cronExpression) continue;

    const [minuteField] = workflow.cronExpression.trim().split(/\s+/);
    const intervalMs = estimateMinIntervalMinutes(minuteField) * 60 * 1000;

    const lastRun = await prisma.workflowRun.findFirst({
      where: { workflowId: workflow.id, trigger: 'SCHEDULE' },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    });

    const elapsedMs = lastRun ? now.getTime() - lastRun.startedAt.getTime() : Infinity;
    if (elapsedMs < intervalMs) {
      results.push({ workflowId: workflow.id, name: workflow.name, ran: false, reason: 'not due' });
      continue;
    }

    try {
      const run = await runWorkflow({ workflow, trigger: 'SCHEDULE', inputPayload: {} });
      results.push({ workflowId: workflow.id, name: workflow.name, ran: true, status: run.status });
    } catch (err) {
      // A rate-limited workflow is an expected outcome, not a tick failure —
      // one noisy workflow must not stop the rest of the tick.
      const reason = err instanceof RateLimitedError ? 'rate limited' : err.message;
      console.error(`Scheduled run failed for workflow ${workflow.id}: ${reason}`);
      results.push({ workflowId: workflow.id, name: workflow.name, ran: false, reason });
    }
  }

  return results;
}

module.exports = { runDueScheduledWorkflows };
