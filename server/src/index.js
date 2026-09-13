require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const authRoutes = require('./routes/auth');
const workflowRoutes = require('./routes/workflows');
const hookRoutes = require('./routes/hooks');
const { seedDatabase } = require('../prisma/seed');
const { initScheduler } = require('./lib/scheduler');

const app = express();

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5175' }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/hooks', hookRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Public demo: reset seed data on a schedule so it self-heals from whatever
// visitors trigger (manual runs, webhook pokes, etc), keeping dates relative
// to "now".
if (process.env.DEMO_RESEED_CRON) {
  cron.schedule(process.env.DEMO_RESEED_CRON, () => {
    console.log('Running scheduled demo reseed...');
    seedDatabase()
      .then(() => initScheduler())
      .catch((err) => console.error('Demo reseed failed:', err));
  });
  console.log(`Demo auto-reseed scheduled: "${process.env.DEMO_RESEED_CRON}"`);
}

const PORT = process.env.PORT || 4200;

initScheduler()
  .catch((err) => console.error('Scheduler init failed:', err))
  .finally(() => {
    app.listen(PORT, () => console.log(`SyncFlow API listening on port ${PORT}`));
  });
