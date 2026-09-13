const express = require('express');
const prisma = require('../prisma');
const { requireAuth } = require('../middleware/auth');
const { runWorkflow, RateLimitedError } = require('../lib/runner');
const { resyncWorkflowSchedule } = require('../lib/scheduler');
const { assertValidCronInterval } = require('../lib/cronRules');
const {
  TRIGGER_TYPES,
  ACTION_TYPES,
  MAX_DELAY_SECONDS,
  MAX_ACTIVE_SCHEDULE_WORKFLOWS,
} = require('../constants');

const router = express.Router();

function serializeWorkflow(workflow) {
  const lastRun = workflow.runs?.[0] || null;
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    triggerType: workflow.triggerType,
    webhookToken: workflow.webhookToken,
    cronExpression: workflow.cronExpression,
    isActive: workflow.isActive,
    createdAt: workflow.createdAt,
    steps: (workflow.steps || [])
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ ...s, config: JSON.parse(s.config || '{}') })),
    lastRun: lastRun
      ? { id: lastRun.id, status: lastRun.status, startedAt: lastRun.startedAt, finishedAt: lastRun.finishedAt }
      : null,
  };
}

async function assertScheduleLimits(cronExpression, excludeWorkflowId) {
  assertValidCronInterval(cronExpression);
  const activeCount = await prisma.workflow.count({
    where: {
      triggerType: 'SCHEDULE',
      isActive: true,
      ...(excludeWorkflowId ? { id: { not: excludeWorkflowId } } : {}),
    },
  });
  if (activeCount >= MAX_ACTIVE_SCHEDULE_WORKFLOWS) {
    throw new Error(
      `Cannot activate: the demo caps active SCHEDULE workflows at ${MAX_ACTIVE_SCHEDULE_WORKFLOWS}`
    );
  }
}

function clampStepConfig(actionType, config) {
  if (actionType === 'DELAY') {
    const seconds = Math.min(Math.max(Number(config.seconds) || 0, 0), MAX_DELAY_SECONDS);
    return { ...config, seconds };
  }
  return config;
}

router.use(requireAuth);

router.get('/', async (req, res) => {
  const workflows = await prisma.workflow.findMany({
    where: { userId: req.user.id },
    include: { steps: true, runs: { orderBy: { startedAt: 'desc' }, take: 1 } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(workflows.map(serializeWorkflow));
});

router.get('/:id', async (req, res) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    include: { steps: true, runs: { orderBy: { startedAt: 'desc' }, take: 1 } },
  });
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
  res.json(serializeWorkflow(workflow));
});

router.post('/', async (req, res) => {
  const { name, description, triggerType, cronExpression } = req.body;
  if (!name || !TRIGGER_TYPES.includes(triggerType)) {
    return res.status(400).json({ error: `triggerType must be one of ${TRIGGER_TYPES.join(', ')}` });
  }

  try {
    if (triggerType === 'SCHEDULE') {
      await assertScheduleLimits(cronExpression);
    }
    const workflow = await prisma.workflow.create({
      data: {
        userId: req.user.id,
        name,
        description: description || null,
        triggerType,
        cronExpression: triggerType === 'SCHEDULE' ? cronExpression : null,
        isActive: true,
      },
      include: { steps: true, runs: true },
    });
    await resyncWorkflowSchedule(workflow.id);
    res.status(201).json(serializeWorkflow(workflow));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

  const { name, description, isActive, cronExpression } = req.body;
  const nextTriggerType = workflow.triggerType;
  const nextCron = cronExpression !== undefined ? cronExpression : workflow.cronExpression;
  const nextActive = isActive !== undefined ? isActive : workflow.isActive;

  try {
    if (nextTriggerType === 'SCHEDULE' && nextActive) {
      await assertScheduleLimits(nextCron, workflow.id);
    }
    const updated = await prisma.workflow.update({
      where: { id: workflow.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
        ...(cronExpression !== undefined && nextTriggerType === 'SCHEDULE' ? { cronExpression } : {}),
      },
      include: { steps: true, runs: { orderBy: { startedAt: 'desc' }, take: 1 } },
    });
    await resyncWorkflowSchedule(updated.id);
    res.json(serializeWorkflow(updated));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
  await prisma.workflow.delete({ where: { id: workflow.id } });
  await resyncWorkflowSchedule(workflow.id);
  res.status(204).end();
});

// --- Steps -----------------------------------------------------------------

router.post('/:id/steps', async (req, res) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    include: { steps: true },
  });
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

  const { actionType, config } = req.body;
  if (!ACTION_TYPES.includes(actionType)) {
    return res.status(400).json({ error: `actionType must be one of ${ACTION_TYPES.join(', ')}` });
  }

  const nextOrder = workflow.steps.length
    ? Math.max(...workflow.steps.map((s) => s.order)) + 1
    : 0;

  const step = await prisma.workflowStep.create({
    data: {
      workflowId: workflow.id,
      order: nextOrder,
      actionType,
      config: JSON.stringify(clampStepConfig(actionType, config || {})),
    },
  });
  res.status(201).json({ ...step, config: JSON.parse(step.config) });
});

router.patch('/:id/steps/:stepId', async (req, res) => {
  const step = await prisma.workflowStep.findFirst({
    where: { id: req.params.stepId, workflowId: req.params.id },
    include: { workflow: true },
  });
  if (!step || step.workflow.userId !== req.user.id) {
    return res.status(404).json({ error: 'Step not found' });
  }

  const { config, order } = req.body;
  const updated = await prisma.workflowStep.update({
    where: { id: step.id },
    data: {
      ...(config !== undefined ? { config: JSON.stringify(clampStepConfig(step.actionType, config)) } : {}),
      ...(order !== undefined ? { order } : {}),
    },
  });
  res.json({ ...updated, config: JSON.parse(updated.config) });
});

router.delete('/:id/steps/:stepId', async (req, res) => {
  const step = await prisma.workflowStep.findFirst({
    where: { id: req.params.stepId, workflowId: req.params.id },
    include: { workflow: true },
  });
  if (!step || step.workflow.userId !== req.user.id) {
    return res.status(404).json({ error: 'Step not found' });
  }
  await prisma.workflowStep.delete({ where: { id: step.id } });
  res.status(204).end();
});

// Reorder: move a step up (-1) or down (+1) by swapping `order` with its neighbor.
router.post('/:id/steps/:stepId/move', async (req, res) => {
  const { direction } = req.body; // 'up' | 'down'
  const workflow = await prisma.workflow.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    include: { steps: true },
  });
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

  const steps = [...workflow.steps].sort((a, b) => a.order - b.order);
  const idx = steps.findIndex((s) => s.id === req.params.stepId);
  if (idx === -1) return res.status(404).json({ error: 'Step not found' });

  const swapWith = direction === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= steps.length) {
    return res.status(400).json({ error: 'Cannot move step further in that direction' });
  }

  const a = steps[idx];
  const b = steps[swapWith];
  await prisma.$transaction([
    prisma.workflowStep.update({ where: { id: a.id }, data: { order: b.order } }),
    prisma.workflowStep.update({ where: { id: b.id }, data: { order: a.order } }),
  ]);
  res.status(204).end();
});

// --- Manual run --------------------------------------------------------------

router.post('/:id/run', async (req, res) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    include: { steps: true },
  });
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

  try {
    const run = await runWorkflow({
      workflow,
      trigger: 'MANUAL',
      inputPayload: req.body?.payload || {},
    });
    res.status(201).json(run);
  } catch (err) {
    if (err instanceof RateLimitedError) return res.status(429).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// --- Run history ---------------------------------------------------------

router.get('/:id/runs', async (req, res) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

  const runs = await prisma.workflowRun.findMany({
    where: { workflowId: workflow.id },
    orderBy: { startedAt: 'desc' },
    take: 50,
  });
  res.json(runs);
});

router.get('/:id/runs/:runId', async (req, res) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

  const run = await prisma.workflowRun.findFirst({
    where: { id: req.params.runId, workflowId: workflow.id },
    include: { stepLogs: { orderBy: { stepOrder: 'asc' } } },
  });
  if (!run) return res.status(404).json({ error: 'Run not found' });

  res.json({
    ...run,
    inputPayload: JSON.parse(run.inputPayload || '{}'),
    stepLogs: run.stepLogs.map((log) => ({ ...log, output: JSON.parse(log.output || '{}') })),
  });
});

module.exports = router;
