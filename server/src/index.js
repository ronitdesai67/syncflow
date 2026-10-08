// Local development entrypoint: binds a port, runs the demo reseed as an
// in-process cron job, and starts the real node-cron scheduler so SCHEDULE
// workflows fire on their true cadence. Production (Vercel) never loads this
// file — it imports src/app.js as a serverless function and drives both the
// reseed and the schedule tick through Vercel Cron instead.
require('dotenv').config();
const cron = require('node-cron');

const app = require('./app');
const { seedDatabase } = require('../prisma/seed');
const { initScheduler } = require('./lib/scheduler');

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
