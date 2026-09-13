const cron = require('node-cron');
const prisma = require('../prisma');
const { runWorkflow } = require('./runner');

// workflowId -> node-cron ScheduledTask, so we can stop/replace a workflow's
// job whenever it's edited or deactivated without restarting the server.
const scheduledTasks = new Map();

function unschedule(workflowId) {
  const task = scheduledTasks.get(workflowId);
  if (task) {
    task.stop();
    scheduledTasks.delete(workflowId);
  }
}

function schedule(workflow) {
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
  const workflows = await prisma.workflow.findMany({
    where: { triggerType: 'SCHEDULE', isActive: true },
  });
  for (const workflow of workflows) schedule(workflow);
  console.log(`Scheduler: ${scheduledTasks.size} active SCHEDULE workflow(s) registered.`);
}

/** Call this after any create/update/delete/toggle so the cron job reflects reality. */
async function resyncWorkflowSchedule(workflowId) {
  const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
  if (!workflow) {
    unschedule(workflowId);
    return;
  }
  schedule(workflow);
}

module.exports = { initScheduler, resyncWorkflowSchedule, unschedule };
