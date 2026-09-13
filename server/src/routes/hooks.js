const express = require('express');
const rateLimit = require('express-rate-limit');
const prisma = require('../prisma');
const { runWorkflow, RateLimitedError } = require('../lib/runner');

const router = express.Router();

// Throttles *requests to this public route* (independent of the in-app
// per-workflow run counter in src/lib/runner.js, which caps actual work
// done). Together these stop the public webhook from being turned into a
// free outbound-request relay / DDoS amplifier.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests to this webhook — slow down.' },
});

// Public, unauthenticated — this is the whole point: a portfolio visitor can
// curl this URL directly from their own terminal and watch a run appear.
router.post('/:workflowId/:token', webhookLimiter, async (req, res) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: req.params.workflowId, webhookToken: req.params.token, triggerType: 'WEBHOOK' },
    include: { steps: true },
  });
  if (!workflow) return res.status(404).json({ error: 'Webhook not found' });
  if (!workflow.isActive) return res.status(403).json({ error: 'This workflow is not active' });

  try {
    const run = await runWorkflow({
      workflow,
      trigger: 'WEBHOOK',
      inputPayload: req.body || {},
    });
    res.status(202).json({ runId: run.id, status: run.status });
  } catch (err) {
    if (err instanceof RateLimitedError) return res.status(429).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
