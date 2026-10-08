const { PrismaClient } = require('@prisma/client');

// On Vercel every cold start re-evaluates this module, and a warm container can
// re-enter it on reload — instantiating a fresh PrismaClient each time would
// open a new connection pool per instance and exhaust Postgres' connection
// limit under even modest traffic. Caching on globalThis keeps exactly one
// client per container. Locally this is a no-op beyond surviving nodemon
// restarts.
const globalForPrisma = globalThis;

const prisma = globalForPrisma.__prisma || new PrismaClient();

if (!globalForPrisma.__prisma) globalForPrisma.__prisma = prisma;

module.exports = prisma;
