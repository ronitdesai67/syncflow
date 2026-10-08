const crypto = require('crypto');
const { seedDatabase } = require('../prisma/seed');

/**
 * Vercel's serverless runtime has no long-lived process, so the public demo's
 * self-healing reseed can't be a node-cron job in production. Vercel Cron (see
 * vercel.json) hits this endpoint on a schedule with
 * `Authorization: Bearer $CRON_SECRET` instead. Local dev still uses node-cron
 * via DEMO_RESEED_CRON in src/index.js — same seed function, different trigger.
 */

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  // No secret configured means no reseed endpoint. Never fall open: this route
  // wipes and rewrites every table.
  if (!secret) return false;

  const presented = Buffer.from(req.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  // Length check first — timingSafeEqual throws on a length mismatch.
  if (presented.length !== expected.length) return false;
  return crypto.timingSafeEqual(presented, expected);
}

/** Express middleware form, for other cron-triggered endpoints. */
function requireCronSecret(req, res, next) {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function mountDemoCron(app, { afterReseed } = {}) {
  app.all('/api/cron/reseed', async (req, res) => {
    if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });
    try {
      await seedDatabase();
      if (afterReseed) await afterReseed();
      res.json({ status: 'reseeded', at: new Date().toISOString() });
    } catch (err) {
      console.error('Demo reseed failed:', err);
      res.status(500).json({ error: 'Reseed failed' });
    }
  });
}

module.exports = { mountDemoCron, requireCronSecret };
