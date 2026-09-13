const prisma = require('../prisma');
const { renderTemplate } = require('./templating');
const { safeHttpRequest, SSRFBlockedError } = require('./safeHttpRequest');
const {
  MAX_DELAY_SECONDS,
  MAX_RUNS_PER_WORKFLOW_PER_HOUR,
  STORED_RESPONSE_BODY_CAP,
} = require('../constants');

class RateLimitedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RateLimitedError';
  }
}

/**
 * In-app execution rate limit: caps total runs per workflow per hour,
 * independent of *how* the run was triggered. This is what stops a public
 * webhook from being hammered into a free outbound-request relay / DDoS
 * amplifier — the express-rate-limit middleware on the webhook route only
 * throttles *requests to that route*; this throttles actual work done
 * (real outbound HTTP calls), and also applies to SCHEDULE and MANUAL runs.
 */
async function assertUnderRunRateLimit(workflowId) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentRunCount = await prisma.workflowRun.count({
    where: { workflowId, startedAt: { gte: oneHourAgo } },
  });
  if (recentRunCount >= MAX_RUNS_PER_WORKFLOW_PER_HOUR) {
    throw new RateLimitedError(
      `Workflow has reached its limit of ${MAX_RUNS_PER_WORKFLOW_PER_HOUR} runs per hour`
    );
  }
}

function truncate(str, cap) {
  if (typeof str !== 'string') return str;
  return str.length > cap ? `${str.slice(0, cap)}… [truncated]` : str;
}

async function executeStep(step, payload) {
  const config = JSON.parse(step.config || '{}');
  const startedAt = Date.now();

  if (step.actionType === 'HTTP_REQUEST') {
    const rendered = renderTemplate(
      { url: config.url, body: config.body, headers: config.headers },
      payload
    );
    try {
      const res = await safeHttpRequest({
        url: rendered.url,
        method: config.method || 'GET',
        headers: rendered.headers || {},
        body: rendered.body,
      });
      return {
        status: 'SUCCESS',
        durationMs: Date.now() - startedAt,
        output: {
          statusCode: res.statusCode,
          responseTimeMs: res.durationMs,
          truncated: res.truncated,
          body: truncate(res.body, STORED_RESPONSE_BODY_CAP),
        },
        error: null,
        nextPayload: payload,
      };
    } catch (err) {
      const blocked = err instanceof SSRFBlockedError;
      return {
        status: 'FAILED',
        durationMs: Date.now() - startedAt,
        output: { blocked },
        error: err.message,
        nextPayload: payload,
      };
    }
  }

  if (step.actionType === 'TRANSFORM') {
    try {
      const nextPayload = renderTemplate(config.template || {}, payload);
      return {
        status: 'SUCCESS',
        durationMs: Date.now() - startedAt,
        output: { payload: nextPayload },
        error: null,
        nextPayload,
      };
    } catch (err) {
      return {
        status: 'FAILED',
        durationMs: Date.now() - startedAt,
        output: {},
        error: err.message,
        nextPayload: payload,
      };
    }
  }

  if (step.actionType === 'DELAY') {
    // Hard server-side cap — never trust the configured value alone.
    const requestedSeconds = Number(config.seconds) || 0;
    const seconds = Math.min(Math.max(requestedSeconds, 0), MAX_DELAY_SECONDS);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    return {
      status: 'SUCCESS',
      durationMs: Date.now() - startedAt,
      output: { requestedSeconds, clampedSeconds: seconds },
      error: null,
      nextPayload: payload,
    };
  }

  if (step.actionType === 'LOG') {
    const message = renderTemplate(config.message || '', payload);
    return {
      status: 'SUCCESS',
      durationMs: Date.now() - startedAt,
      output: { message },
      error: null,
      nextPayload: payload,
    };
  }

  return {
    status: 'FAILED',
    durationMs: Date.now() - startedAt,
    output: {},
    error: `Unknown action type "${step.actionType}"`,
    nextPayload: payload,
  };
}

/**
 * Runs a workflow end-to-end: creates the WorkflowRun row, executes each
 * step in order (stopping and marking the remainder SKIPPED on the first
 * failure), writes a RunStepLog row per step, and finalizes the run status.
 */
async function runWorkflow({ workflow, trigger, inputPayload }) {
  await assertUnderRunRateLimit(workflow.id);

  const run = await prisma.workflowRun.create({
    data: {
      workflowId: workflow.id,
      status: 'RUNNING',
      trigger,
      inputPayload: JSON.stringify(inputPayload ?? {}),
    },
  });

  const steps = [...workflow.steps].sort((a, b) => a.order - b.order);
  let payload = inputPayload ?? {};
  let failed = false;

  for (const step of steps) {
    if (failed) {
      await prisma.runStepLog.create({
        data: {
          runId: run.id,
          stepOrder: step.order,
          actionType: step.actionType,
          status: 'SKIPPED',
          durationMs: 0,
          output: JSON.stringify({}),
          error: 'Skipped because a previous step failed',
        },
      });
      continue;
    }

    const result = await executeStep(step, payload);
    await prisma.runStepLog.create({
      data: {
        runId: run.id,
        stepOrder: step.order,
        actionType: step.actionType,
        status: result.status,
        durationMs: result.durationMs,
        output: JSON.stringify(result.output ?? {}),
        error: result.error,
      },
    });

    if (result.status === 'FAILED') {
      failed = true;
    } else {
      payload = result.nextPayload;
    }
  }

  const finished = await prisma.workflowRun.update({
    where: { id: run.id },
    data: {
      status: failed ? 'FAILED' : 'SUCCESS',
      finishedAt: new Date(),
    },
  });

  return finished;
}

module.exports = { runWorkflow, RateLimitedError, assertUnderRunRateLimit };
