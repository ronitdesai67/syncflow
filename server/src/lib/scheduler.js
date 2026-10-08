const cron = require('node-cron');
const prisma = require('../prisma');
const { runWorkflow } = require('./runner');

// workflowId -> node-cron ScheduledTask, so we can stop/replace a workflow's
// job whenever it's edited or deactivated without restarting the server.
const scheduledTasks = new Map();

// On Vercel there is no long-lived process to hold a timer: a function is torn
// down as soon as its request finishes, so a node-cron task registered here
// would be discarded before it ever fired. Production drives SCHEDULE
// workflows through Vercel Cron -> /api/cron/tick instead (lib/scheduleTick.js),
// and every function below becomes an explicit no-op rather than quietly
// building timers that nothing will ever run.
const IS_SERVERLESS = Boolean(process.env.VERCEL);

function unschedule(workflowId) {
  const task = scheduledTasks.get(workflowId);
  if (task) {
    task.stop();
    scheduledTasks.delete(workflowId);
  }
}

function schedule(workflow) {
  if (IS_SERVERLESS) return;
  unschedule(workflow.id);
  if (workflow.triggerType !== 'SCHEDULE' || !workflow.isActive || !workflow.cronExpression) return;
  if (!cron.validate(workflow.cronExpression)) return;

  const task = cron.schedule(workflow.cronExpression, async () => {
    try {
      const fresh = await prisma.workflow.findUnique({
        where: { id: workflow.id },
        include: { steps: true },
      });
      if (!fresh || !fresh.isActive) return;
      await runWorkflow({ workflow: fresh, trigger: 'SCHEDULE', inputPayload: {} });
    } catch (err) {
      console.error(`Scheduled run failed for workflow ${workflow.id}:`, err.message);
    }
  });

  scheduledTasks.set(workflow.id, task);
}

/** Loads every active SCHEDULE workflow and starts its cron job. Called once at boot. */
async function initScheduler() {
  if (IS_SERVERLESS) return;
  const workflows = await prisma.workflow.findMany({
    where: { triggerType: 'SCHEDULE', isActive: true },
  });
  for (const workflow of workflows) schedule(workflow);
  console.log(`Scheduler: ${scheduledTasks.size} active SCHEDULE workflow(s) registered.`);
}

/** Call this after any create/update/delete/toggle so the cron job reflects reality. */
async function resyncWorkflowSchedule(workflowId) {
  if (IS_SERVERLESS) return;
  const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
  if (!workflow) {
    unschedule(workflowId);
    return;
  }
  schedule(workflow);
}

module.exports = { initScheduler, resyncWorkflowSchedule, unschedule };
