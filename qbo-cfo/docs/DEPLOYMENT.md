# Deployment

Production deployment and day-two operations.

---

## Requirements

- Node.js 20+
- PostgreSQL 14+ (managed is fine — RDS, Cloud SQL, Neon, Supabase)
- HTTPS on a stable public origin, because the Intuit redirect URI must match it
  exactly
- Outbound HTTPS to `oauth.platform.intuit.com`, `quickbooks.api.intuit.com`
  (or the sandbox host) and, if AI is enabled, `api.openai.com`

---

## 1. Provision the database

```bash
createdb qbo_cfo
export DATABASE_URL='postgresql://user:pass@host:5432/qbo_cfo?sslmode=require'
npm ci
npm run db:migrate
```

`db:migrate` applies `db/schema.sql` (idempotent) and creates the owner account
from `OWNER_EMAIL` / `OWNER_PASSWORD` if no user exists. **Change that password
immediately after the first sign-in.**

## 2. Generate secrets

```bash
node -e "console.log('TOKEN_ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('SESSION_SECRET='       + require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('CRON_SECRET='          + require('crypto').randomBytes(24).toString('hex'))"
```

Store them in your platform's secret manager, not in the repository.

> **`TOKEN_ENCRYPTION_KEY` is not rotatable without re-authorisation.** It
> decrypts stored QuickBooks tokens. If it is lost, every company must
> reconnect. Back it up where you back up database credentials.

## 3. Configure the environment

```bash
DATABASE_URL=postgresql://…?sslmode=require
NEXT_PUBLIC_APP_URL=https://cfo.example.com

INTUIT_CLIENT_ID=…                 # production keys
INTUIT_CLIENT_SECRET=…
INTUIT_REDIRECT_URI=https://cfo.example.com/api/quickbooks/callback
INTUIT_ENVIRONMENT=production

OPENAI_API_KEY=…                   # optional
OPENAI_MODEL=gpt-4.1

TOKEN_ENCRYPTION_KEY=…
SESSION_SECRET=…
CRON_SECRET=…
DEMO_MODE=false                    # disable synthetic data in production
NODE_ENV=production
```

Add `INTUIT_REDIRECT_URI` to the Intuit app's redirect list before going live.

## 4. Build and run

```bash
npm ci
npm run build
npm run start          # listens on $PORT, default 3000
```

Run behind a reverse proxy that terminates TLS and forwards
`X-Forwarded-For` — the audit log and login throttle read it.

### Container

```dockerfile
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "run", "start"]
```

### Serverless

The app runs on Vercel and similar platforms unchanged. Note that report
generation and historical imports are long-running: the relevant route handlers
declare `maxDuration` (up to 300s), and a 36-month import may still need to be
split into smaller runs on a platform with a hard request ceiling. Importing 12
months at a time is a safe pattern.

## 5. Schedule the monthly close

Default: the **3rd of each month**, for the month that just closed.

**HTTP** (Vercel Cron, Cloud Scheduler, GitHub Actions):

```
POST https://cfo.example.com/api/cron/monthly
Authorization: Bearer <CRON_SECRET>
```

`vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/monthly", "schedule": "0 9 3 * *" }] }
```

**System cron**, if you prefer running it on the host:

```cron
0 9 3 * * cd /srv/qbo-cfo && npm run cron:monthly >> /var/log/qbo-cfo-cron.log 2>&1
```

Useful flags: `--force` runs every company regardless of its configured day;
`--company <uuid>` runs one.

The endpoint is safe to call more than once a day: a company that already ran
today is skipped.

## 6. Operations

### Health

`GET /api/health` is unauthenticated by design — a load balancer has to reach
it — and carries no secret. It reports whether each dependency is *configured*
and *reachable*, never a credential, host or connection string:

```json
{
  "status": "ok",
  "app": { "name": "qbo-cfo", "version": "1.0.0", "environment": "production",
           "demoMode": false, "uptimeSeconds": 3821 },
  "database": { "ok": true, "latencyMs": 3, "migrationsApplied": true, "error": null },
  "scheduler": { "configured": true, "enabledCompanies": 1, "lastRunAt": "...",
                 "lastRunStatus": "completed", "staleLocks": 0 },
  "quickbooks": { "configured": true, "environment": "production",
                  "clientIdPresent": true, "redirectUriConfigured": true },
  "ai": { "configured": true, "model": "gpt-4.1",
          "promptVersions": { "cfo": "cfo_system_prompt_v1.0", "chat": "cfo_chat_prompt_v1.0" } }
}
```

It returns **`503`** when the database is unreachable, so an orchestrator can
take the instance out of rotation, and always sets `Cache-Control: no-store`.

Watch `scheduler.staleLocks`: a non-zero value that persists means a sync died
holding a lock, and the next scheduled run for that company-month will be
refused until the lock expires.

Also useful:

- `GET /login` returns 200 and reports a database problem in-page if the
  connection is down.
- *Settings → QuickBooks* shows connection status, token expiry, refresh
  failures, last sync and the full sync history with warnings.
- *Settings* shows the audit log.

### Backups

Back up the database on your provider's normal schedule. `report_snapshots`
holds the raw QuickBooks JSON, so a restore can recompute every metric without
contacting Intuit. Keep `TOKEN_ENCRYPTION_KEY` with — but not *in* — the backup.

### Retention

`report_schedules.retention_months` (default 36) prunes raw snapshots during the
monthly run. Computed monthly metrics are never pruned.

### Log hygiene

Logs are structured JSON with secret redaction applied to every string:
bearer tokens, OAuth tokens, client secrets and API keys are replaced before
emission. Do not add `console.log` calls that bypass `src/lib/logger.ts`.

The same redaction runs over every user-facing error message, so no provider
payload or connection string can reach the screen even if one reaches an
exception.

### Events to alert on

`src/lib/observability.ts` defines a typed event vocabulary. The ones worth an
alert:

| Event | Meaning |
|---|---|
| `qbo.token_refresh_failed` | The connection is dying. The owner must reconnect; nothing will sync until they do |
| `sync.failed` | A month did not import. Figures for that month are missing, not wrong |
| `sync.lock_contended` | Two syncs raced. Expected occasionally; persistent contention means a stuck lock |
| `report.failed` | A scheduled month-end produced nothing |
| `ai.injection_signal` | An accounting field contains instruction-like text. Not an incident by itself — it is treated as data — but worth a look at who created that record |
| `qbo.rate_limited` | Backoff is working; frequent occurrences mean imports are too aggressive |

---

## Failure modes and responses

| Symptom | Response |
|---|---|
| Connection shows `error`, token unhealthy | Reconnect from Settings → QuickBooks. The refresh token likely expired (~100 days idle) |
| Sync finishes `partial` | Expand the warnings on the connection page; each names the month and report. Re-run the month from the same page |
| `QBO_RATE_LIMITED` | The client already backs off; re-run the sync later. Consider importing fewer months at once |
| Report generation fails | The report row is marked `failed` with the message. Fix the cause and regenerate — the same row is reused |
| AI unavailable | Reports still complete with application-written commentary and a warning explaining why |
| PDF or Excel export fails | Typed `PDF_ERROR` / `EXCEL_ERROR`; the report itself is unaffected and can be re-exported |
| Balance sheet does not balance | The stored copy is incomplete. Re-sync the month; confidence stays Low until it does |

---

## Upgrading

```bash
git pull
npm ci
npm run db:migrate      # idempotent, and safe to run from two instances at once
npm run build
# restart the service
```

Schema changes are additive; `db/schema.sql` is safe to re-apply, and schema
application is serialised behind an advisory lock so two instances booting
simultaneously cannot deadlock on the system catalogs.

Reports generated before the upgrade stay readable. Their stored payloads are
normalised to the current shape on read, with fields that were not recorded
shown as not recorded rather than backfilled with zeros. Regenerating a report
is what produces current figures, and it appends a version rather than
overwriting the one that was issued.

After upgrading, confirm:

```bash
curl -s https://your-app.example.com/api/health | jq .status   # "ok"
npm run reconcile -- --period <latest closed month>            # RESULT: PASS
```

---

## Security checklist before go-live

- [ ] `DEMO_MODE=false`
- [ ] `TOKEN_ENCRYPTION_KEY` and `SESSION_SECRET` are unique, 32 bytes, and backed up
- [ ] `CRON_SECRET` is set — without it the scheduler endpoint refuses every request
- [ ] The bootstrap owner password has been changed
- [ ] `INTUIT_ENVIRONMENT=production` and the redirect URI matches the Intuit app
- [ ] Only the `com.intuit.quickbooks.accounting` scope is granted
- [ ] TLS terminates in front of the app and `X-Forwarded-For` is forwarded
- [ ] Database backups are running and restore has been tested
      (see [`BACKUP_RECOVERY.md`](BACKUP_RECOVERY.md))
- [ ] [`SECURITY_REVIEW.md`](SECURITY_REVIEW.md) has been read and its accepted
      limitations are acceptable for this deployment
- [ ] The full [`PRODUCTION_CHECKLIST.md`](PRODUCTION_CHECKLIST.md) has been
      worked through — this list is the security subset of it
- [ ] `npm test` passes against the deployment's Node version
