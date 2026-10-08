require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const workflowRoutes = require('./routes/workflows');
const hookRoutes = require('./routes/hooks');
const { mountDemoCron, requireCronSecret } = require('./demoCron');
const { runDueScheduledWorkflows } = require('./lib/scheduleTick');
const { initScheduler } = require('./lib/scheduler');

const app = express();

// In production the client and API share one Vercel domain, so browser calls
// are same-origin and never preflight. The webhook endpoint under /api/hooks
// is called server-to-server from anywhere, which CORS does not govern.
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5175' }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/hooks', hookRoutes);

// Serverless stand-in for the node-cron scheduler — see lib/scheduleTick.js.
// Vercel Cron calls this; locally node-cron fires the workflows directly and
// this endpoint just sits unused.
app.all('/api/cron/tick', requireCronSecret, async (req, res) => {
  try {
    const results = await runDueScheduledWorkflows();
    res.json({ status: 'ticked', at: new Date().toISOString(), results });
  } catch (err) {
    console.error('Schedule tick failed:', err);
    res.status(500).json({ error: 'Tick failed' });
  }
});

// A reseed rewrites the workflow rows, so the in-process cron jobs (local dev
// only) have to be rebuilt against the new IDs afterwards.
mountDemoCron(app, { afterReseed: initScheduler });

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
