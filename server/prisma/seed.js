const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const DEMO_EMAIL = 'ops@fieldstream.io';
const DEMO_PASSWORD = 'demo1234';
const DEMO_NAME = 'Jordan Casey';

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000);
}

/**
 * Builds a believable, backfilled run + step-log history for a workflow so
 * the run history / logs pages have real depth on first load instead of an
 * empty state. This is synthetic (no live network calls happen at seed
 * time) — triggering the workflow for real, via its webhook/"Run now"
 * button/schedule, makes a genuine outbound call to the public test
 * endpoint referenced in its HTTP_REQUEST step config.
 */
async function createRunHistory(workflow, trigger, stepDefs, count) {
  for (let i = count; i >= 1; i--) {
    const startedAt = minutesAgo(i * randomInt(35, 240));
    const isFailure = i === count && Math.random() < 0.25; // occasional believable failure, oldest run
    let cursor = startedAt.getTime();

    const run = await prisma.workflowRun.create({
      data: {
        workflowId: workflow.id,
        status: 'RUNNING',
        trigger,
        startedAt,
        inputPayload: JSON.stringify(stepDefs.samplePayload || {}),
      },
    });

    let failedAlready = false;
    for (const step of stepDefs.steps) {
      const durationMs = step.durationRange
        ? randomInt(step.durationRange[0], step.durationRange[1])
        : randomInt(20, 150);
      cursor += durationMs;

      const shouldFail = isFailure && step.canFail && !failedAlready && Math.random() < 0.6;
      if (shouldFail) failedAlready = true;

      await prisma.runStepLog.create({
        data: {
          runId: run.id,
          stepOrder: step.order,
          actionType: step.actionType,
          status: failedAlready && !shouldFail ? 'SKIPPED' : shouldFail ? 'FAILED' : 'SUCCESS',
          durationMs: failedAlready && !shouldFail ? 0 : durationMs,
          output: JSON.stringify(
            failedAlready && !shouldFail ? {} : shouldFail ? {} : step.output || {}
          ),
          error: shouldFail ? step.failureMessage || 'Request failed' : null,
        },
      });
    }

    await prisma.workflowRun.update({
      where: { id: run.id },
      data: { status: failedAlready ? 'FAILED' : 'SUCCESS', finishedAt: new Date(cursor) },
    });
  }
}

async function main() {
  console.log('Seeding SyncFlow demo data for "Fieldstream" (ops-heavy logistics startup)...');

  await prisma.runStepLog.deleteMany();
  await prisma.workflowRun.deleteMany();
  await prisma.workflowStep.deleteMany();
  await prisma.workflow.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const user = await prisma.user.create({
    data: { email: DEMO_EMAIL, passwordHash, fullName: DEMO_NAME },
  });

  // --- Workflow 1: WEBHOOK — New driver signup -> CRM sync ------------------
  const signupWorkflow = await prisma.workflow.create({
    data: {
      userId: user.id,
      name: 'New Driver Signup → CRM Sync',
      description:
        'Fires when the driver-onboarding form posts a new signup. Reshapes the payload and pushes it to the CRM webhook.',
      triggerType: 'WEBHOOK',
      isActive: true,
    },
  });
  await prisma.workflowStep.createMany({
    data: [
      {
        workflowId: signupWorkflow.id,
        order: 0,
        actionType: 'LOG',
        config: JSON.stringify({ message: 'New signup received for {{name}} ({{email}})' }),
      },
      {
        workflowId: signupWorkflow.id,
        order: 1,
        actionType: 'TRANSFORM',
        config: JSON.stringify({
          template: {
            contact_name: '{{name}}',
            contact_email: '{{email}}',
            source: 'fieldstream-onboarding',
            vehicle_type: '{{vehicle.type}}',
          },
        }),
      },
      {
        workflowId: signupWorkflow.id,
        order: 2,
        actionType: 'HTTP_REQUEST',
        config: JSON.stringify({
          url: 'https://httpbin.org/post',
          method: 'POST',
          headers: { 'X-Source': 'syncflow-demo' },
          body: { contact_name: '{{contact_name}}', contact_email: '{{contact_email}}' },
        }),
      },
    ],
  });
  await createRunHistory(
    signupWorkflow,
    'WEBHOOK',
    {
      samplePayload: { name: 'Alicia Moore', email: 'alicia.moore@example.com', vehicle: { type: 'van' } },
      steps: [
        {
          order: 0,
          actionType: 'LOG',
          output: { message: 'New signup received for Alicia Moore (alicia.moore@example.com)' },
        },
        {
          order: 1,
          actionType: 'TRANSFORM',
          output: {
            payload: {
              contact_name: 'Alicia Moore',
              contact_email: 'alicia.moore@example.com',
              source: 'fieldstream-onboarding',
              vehicle_type: 'van',
            },
          },
        },
        {
          order: 2,
          actionType: 'HTTP_REQUEST',
          durationRange: [180, 620],
          output: { statusCode: 200, responseTimeMs: 340, truncated: false, body: '{"json":{"contact_name":"Alicia Moore"}} [truncated]' },
          canFail: true,
          failureMessage: 'Request timed out after 5000ms',
        },
      ],
    },
    6
  );

  // --- Workflow 2: SCHEDULE — Nightly inventory reconciliation --------------
  const inventoryWorkflow = await prisma.workflow.create({
    data: {
      userId: user.id,
      name: 'Nightly Inventory Reconciliation',
      description:
        'Runs every night at 2am — pulls the warehouse feed, reshapes it, and logs a reconciliation summary.',
      triggerType: 'SCHEDULE',
      cronExpression: '0 2 * * *',
      isActive: true,
    },
  });
  await prisma.workflowStep.createMany({
    data: [
      {
        workflowId: inventoryWorkflow.id,
        order: 0,
        actionType: 'HTTP_REQUEST',
        config: JSON.stringify({ url: 'https://jsonplaceholder.typicode.com/todos/1', method: 'GET' }),
      },
      {
        workflowId: inventoryWorkflow.id,
        order: 1,
        actionType: 'TRANSFORM',
        config: JSON.stringify({
          template: { warehouse: 'FS-DEN-01', reconciled_at: '{{title}}', status: 'complete' },
        }),
      },
      {
        workflowId: inventoryWorkflow.id,
        order: 2,
        actionType: 'LOG',
        config: JSON.stringify({ message: 'Reconciliation complete for warehouse {{warehouse}}' }),
      },
    ],
  });
  await createRunHistory(
    inventoryWorkflow,
    'SCHEDULE',
    {
      samplePayload: {},
      steps: [
        {
          order: 0,
          actionType: 'HTTP_REQUEST',
          durationRange: [90, 300],
          output: { statusCode: 200, responseTimeMs: 145, truncated: false, body: '{"userId":1,"id":1,"title":"delectus aut autem","completed":false}' },
          canFail: true,
          failureMessage: 'Request timed out after 5000ms',
        },
        {
          order: 1,
          actionType: 'TRANSFORM',
          output: { payload: { warehouse: 'FS-DEN-01', reconciled_at: 'delectus aut autem', status: 'complete' } },
        },
        { order: 2, actionType: 'LOG', output: { message: 'Reconciliation complete for warehouse FS-DEN-01' } },
      ],
    },
    8
  );

  // --- Workflow 3: MANUAL — On-demand data export ---------------------------
  const exportWorkflow = await prisma.workflow.create({
    data: {
      userId: user.id,
      name: 'On-Demand Fleet Data Export',
      description: 'Manually triggered export used by ops when finance requests an ad-hoc fleet snapshot.',
      triggerType: 'MANUAL',
      isActive: true,
    },
  });
  await prisma.workflowStep.createMany({
    data: [
      {
        workflowId: exportWorkflow.id,
        order: 0,
        actionType: 'HTTP_REQUEST',
        config: JSON.stringify({
          url: 'https://httpbin.org/post',
          method: 'POST',
          body: { export: 'fleet-snapshot', requested_by: 'ops@fieldstream.io' },
        }),
      },
      {
        workflowId: exportWorkflow.id,
        order: 1,
        actionType: 'DELAY',
        config: JSON.stringify({ seconds: 2 }),
      },
      {
        workflowId: exportWorkflow.id,
        order: 2,
        actionType: 'LOG',
        config: JSON.stringify({ message: 'Fleet snapshot export finished' }),
      },
    ],
  });
  await createRunHistory(
    exportWorkflow,
    'MANUAL',
    {
      samplePayload: {},
      steps: [
        {
          order: 0,
          actionType: 'HTTP_REQUEST',
          durationRange: [200, 700],
          output: { statusCode: 200, responseTimeMs: 410, truncated: false, body: '{"json":{"export":"fleet-snapshot"}} [truncated]' },
          canFail: true,
          failureMessage: 'Request timed out after 5000ms',
        },
        { order: 1, actionType: 'DELAY', durationRange: [1900, 2100], output: { requestedSeconds: 2, clampedSeconds: 2 } },
        { order: 2, actionType: 'LOG', output: { message: 'Fleet snapshot export finished' } },
      ],
    },
    4
  );

  console.log('Seed complete.');
  console.log(`Demo login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

// Exported so the running server can call this on a schedule and reset the
// public demo, undoing whatever visitors triggered.
module.exports = { seedDatabase: main, DEMO_PASSWORD, DEMO_EMAIL };

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
