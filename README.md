# SyncFlow — workflow automation builder

A lightweight, Zapier-style workflow automation platform built for **Fieldstream Logistics** (fictional client, built as a portfolio case study) — an ops-heavy startup whose team was manually copy-pasting data between their onboarding form, warehouse system, and CRM every day.

**Live demo:** _add your deployed URL here_
**Demo login** (one click on the login screen, no typing):

| Email | Password |
|---|---|
| `ops@fieldstream.io` | `demo1234` |

## The problem

Fieldstream's ops team had three manual, error-prone data-shuffling chores: pushing new driver signups into the CRM, reconciling warehouse inventory every night, and pulling ad-hoc fleet exports for finance. Each one meant someone copying values between systems by hand. They needed a small, auditable automation layer — not a full iPaaS, just workflows they could trust enough to point at real external systems.

## What was built

- **Workflow builder**: a trigger (webhook / schedule / manual button) followed by an ordered list of steps — `HTTP_REQUEST`, `TRANSFORM`, `DELAY`, `LOG` — with add/remove/reorder (up/down) controls. Intentionally *not* an arbitrary-code-execution sandbox: templating uses safe `{{field}}` property-path substitution only, never `eval`/`new Function`/`vm`.
- **Real, live triggers**:
  - **Webhook** — `POST /api/hooks/:workflowId/:token` is a genuinely public endpoint. The workflow page shows the full URL and a ready-to-copy `curl` command so you can trigger it from your own terminal and watch a run appear.
  - **Schedule** — actual `node-cron` jobs run active SCHEDULE workflows on their configured cadence, re-synced whenever a workflow is edited.
  - **Manual** — a "Run now" button that runs immediately; the UI polls every 2s while a run is in flight.
- **Per-step observability**: every run logs status, duration, and (truncated) output for each step — this is the actual product, more than the builder UI. A run that fails partway shows exactly which step failed and marks the rest `SKIPPED`, not just a generic "workflow failed."
- **Seed data**: three real workflows for Fieldstream with backfilled run history, each demonstrating genuine outbound calls to public test endpoints (`httpbin.org`, `jsonplaceholder.typicode.com`) — never to anything private.

## SSRF defense — the engineering detail this project is actually about

An `HTTP_REQUEST` step that calls a user-supplied URL from the server, triggered by a public webhook, is a textbook SSRF vector — anyone could point it at `169.254.169.254` (cloud metadata), an internal admin panel, or `localhost` and use this server as a proxy into infrastructure it was never meant to reach. This isn't a bolt-on disclaimer; it's the part of this build I'd point a security-conscious client to first:

- **DNS resolved and re-validated at request time, not save time.** `src/lib/ssrf.js` runs `dns.lookup` immediately before every outbound call and rejects it if any resolved address falls in a private/reserved/loopback/link-local range (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`, `fe80::/10`), using an allowlist (only `unicast` addresses pass) rather than trying to hand-enumerate every bad range.
- **Connection pinned to the validated IP.** `src/lib/safeHttpRequest.js` dials the exact IP that was just validated (with the original hostname sent via `Host` header / TLS SNI) instead of handing the hostname back to Node's HTTP client, which would perform its *own* DNS lookup — closing the classic DNS-rebinding gap where a second lookup returns a different (private) answer after the check passes.
- **Scheme allowlist**: only `http:`/`https:`; `file:`, `ftp:`, `gopher:`, etc. are rejected outright, as are `localhost`/`0.0.0.0` by hostname before any DNS call.
- **Resource bounds**: 5-second hard timeout, 1MB response-read cap, and stored response bodies truncated to ~2KB.
- **This validation lives in the HTTP_REQUEST executor itself** — one choke point — so it applies identically whether the run was triggered by webhook, schedule, or the manual "Run now" button. It can't be bypassed by a future trigger type that forgets to call it.
- **Execution rate limiting, independent of request rate limiting**: `express-rate-limit` throttles requests to the public webhook route, and a separate in-app counter caps actual runs at 30/workflow/hour — so the webhook can't be turned into a free outbound-request relay by an attacker who just wants to hammer it, even if they stay under the request-rate limit by spacing calls out.
- **Bounded background load**: active `SCHEDULE` workflows are capped, and cron expressions implying a firing interval under 5 minutes are rejected server-side (a client-side check mirrors this for immediate feedback, but the server is the enforcement point). `DELAY` steps are clamped to a hard 10-second maximum regardless of configured value.

## Tech stack

- **Backend:** Node.js, Express, Prisma ORM, PostgreSQL (swappable to Postgres via `DATABASE_URL`), `node-cron` for schedules, `express-rate-limit`, `ipaddr.js` for SSRF range classification, `lodash.get` for safe (non-`eval`) template resolution
- **Frontend:** React 19, Vite, Tailwind CSS, React Router
- **Auth:** JWT, bcrypt password hashing, single demo account (this project's focus is the automation engine, not multi-tenant org management)

## Running it locally

Needs a PostgreSQL database. Create one and point `server/.env` at it
(copy `server/.env.example` for the full list of variables):

```bash
# Backend
cd server
npm install
cp .env.example .env          # then set DATABASE_URL
npx prisma migrate deploy
node prisma/seed.js
npm run dev        # http://localhost:4200

# Frontend (separate terminal)
cd client
npm install
npm run dev         # http://localhost:5175
```

The client calls `/api` as a relative path and Vite proxies it to the
backend port in dev, which is the same path it uses in production -- so
there is no API URL to configure in either environment.

Try the webhook live once it's running:

```bash
curl -X POST http://localhost:4200/api/hooks/<workflowId>/<webhookToken> \
  -H "Content-Type: application/json" \
  -d '{"name": "Ada Lovelace", "email": "ada@example.com"}'
```

(The exact URL and curl command for each seeded workflow are shown on its detail page.)

## Notes on the public demo

1. A daily Vercel Cron job (`/api/cron/reseed`) re-runs the seed script on a schedule, undoing whatever visitors triggered — extra runs, added steps, deactivated workflows — and re-syncs the scheduler afterward.
2. Run-history timestamps in the seed data are generated relative to "now" at seed time, so the demo never looks stale no matter when someone visits.
3. The webhook and "Run now" trigger real outbound HTTP calls to public test endpoints — expect the occasional slow response or timeout from those third-party services; that's real network behavior, not a bug, and it's exactly what the per-step logging is designed to surface honestly.

## Deploying

This deploys to Vercel as a **single project**: the Vite client builds to
static files and the Express API runs as one serverless function mounted at
`/api` on the same domain (`api/index.js` simply exports the app). Because
both halves share an origin, there is no CORS configuration and no API URL to
keep in sync.

Two consequences of serverless shaped the code:

- **Postgres, not SQLite.** Vercel's filesystem is read-only apart from an
  ephemeral `/tmp`, so a SQLite file cannot persist anything a visitor does.
  `src/prisma.js` also caches the client on `globalThis` so a warm container
  reuses one connection pool instead of opening a new one per invocation.
- **Cron is external.** There is no long-lived process to hold a timer, so the
  demo reseed runs as a Vercel Cron job against `/api/cron/reseed`, guarded by
  a `CRON_SECRET` bearer token (the endpoint rewrites every table, so it
  refuses all requests when that secret is unset).

`node-cron` still drives SCHEDULE workflows in local development, where the
server is a long-lived process. On Vercel it cannot: a function is torn down
as soon as its request finishes, so `src/lib/scheduler.js` becomes an explicit
no-op there and Vercel Cron calls `/api/cron/tick` instead. That endpoint
(`src/lib/scheduleTick.js`) works out which workflows are *due* by reusing the
same conservative minute-field heuristic the create/update validator already
applies, so a workflow never fires more often than its cron expression allows.
On the Vercel Hobby plan crons run once a day, which makes scheduled runs in
the public demo daily rather than hourly -- the webhook and "Run now" triggers
are unaffected and still fire instantly.

Required environment variables (see `server/.env.example`): `DATABASE_URL`,
`JWT_SECRET`, `CRON_SECRET`. The build command runs `prisma migrate deploy`
and the seed script, so a fresh deploy provisions and populates its own
database.

## What I'd build next for a real client

- Retry-with-backoff policy per step, configurable per workflow
- A richer TRANSFORM step (array mapping/filtering, not just flat object templating)
- Slack/email alerting on run failure
- Per-workflow webhook secret/signature verification in addition to the unguessable token in the URL
