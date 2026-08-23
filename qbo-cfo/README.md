# QuickBooks Online — Monthly CFO Reporting Agent

A read-only financial intelligence layer for a multi-location retail business.
QuickBooks Online stays the system of record; this application turns the
bookkeeping in it into **what happened → why it matters → what needs attention
→ what to do next**.

> **Read-only by construction.** The application never creates, modifies,
> deletes, reconciles, categorises, or posts anything in QuickBooks. The API
> client only issues `GET` requests and rejects mutating endpoints and
> non-`SELECT` queries before a request is built. See
> [Security](#security-model).

---

## Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Local setup](#local-setup)
- [Database setup](#database-setup)
- [Intuit developer setup](#intuit-developer-setup)
- [Environment variables](#environment-variables)
- [Running locally](#running-locally)
- [Demo mode](#demo-mode)
- [Production deployment](#production-deployment)
- [Monthly scheduler setup](#monthly-scheduler-setup)
- [Testing](#testing)
- [Security model](#security-model)
- [Documentation](#documentation)

---

## What it does

Connect a QuickBooks Online company, import history, and the application will:

| Capability | Where |
|---|---|
| KPI dashboard with month / YoY / YTD / trailing-12 comparisons | `/dashboard` |
| Full monthly CFO report (12 sections) with PDF and Excel export | `/reports` |
| Natural-language questions answered from the database, not model memory | `/cfo-chat` |
| Store-level performance from QuickBooks Locations or Classes | `/stores` |
| Expense analysis with drill-down to the underlying transactions | `/expenses` |
| Vendor spend, new-vendor and spend-jump detection | `/vendors` |
| A/R and A/P aging with the largest overdue balances | `/receivables`, `/payables` |
| Review queue for large, duplicate, uncategorised and unusual transactions | `/transactions-review` |
| Close checklist and a Report Confidence score | `/monthly-close` |
| Account mapping, alert thresholds, branding, schedule | `/settings/*` |
| Guided first-run setup | `/onboarding` |

Everything numeric is computed by the application from stored QuickBooks data.
The language model explains those numbers; it never produces them.

---

## Architecture

```
Browser
  │  Next.js App Router (React 19, Tailwind v4, Recharts)
  ▼
Server components + route handlers  ──────────────┐
  │                                               │
  │  lib/qbo         OAuth 2.0, read-only client, │  lib/ai
  │                  report parsers               │    context builder
  │  lib/finance     mapping, metrics, KPIs,      │    CFO insights
  │                  anomalies, data quality      │    NL query pipeline
  │  lib/reports     payload builder, PDF, XLSX   │
  │  lib/db          repositories over PostgreSQL │
  ▼                                               ▼
PostgreSQL                                   OpenAI API
  raw snapshots · computed metrics ·         (explanation only —
  anomalies · reports · audit log             never arithmetic)
```

The data flow is deliberately one-directional:

```
QuickBooks report JSON
   → report_snapshots        (stored verbatim, the audit trail)
   → parsed statements       (classified by QuickBooks AccountType, not by name)
   → account mapping         (owner-approved account → management category)
   → monthly_metrics         (deterministic, reproducible from snapshots)
   → KPIs, comparisons, anomalies, data-quality checks
   → report payload          (every figure in the report lives here)
   → AI commentary           (may only quote figures present in the payload)
```

Because metrics are derived from stored snapshots, changing an account mapping
recomputes every historical month **without another QuickBooks call**.

### Key directories

```
db/schema.sql              PostgreSQL schema (idempotent)
scripts/                   migrate, seed-demo, run-monthly
src/lib/qbo/               Intuit OAuth, read-only client, report parsing
src/lib/finance/           categories, mapping, metrics, KPIs, anomalies,
                           locations, transaction review, data quality
src/lib/reports/           report payload builder, PDF renderer, XLSX exporter
src/lib/ai/                prompts, context, insights, intent, NL query pipeline
src/lib/db/repositories/   one module per aggregate
src/lib/demo/              synthetic multi-store furniture retailer
src/app/                   pages and API route handlers
src/components/            UI primitives, charts, report renderer
tests/                     unit tests, mock datasets, integration suites
```

---

## Local setup

Requirements: **Node 20+** and **PostgreSQL 14+**.

```bash
cd qbo-cfo
npm install
cp .env.example .env.local     # then fill in the values below
npm run db:migrate             # applies db/schema.sql, creates the owner account
npm run db:seed-demo           # optional: 24 months of synthetic data
npm run dev                    # http://localhost:3000
```

Sign in at `/login`. If no user exists yet, the first sign-in creates the owner
account with the credentials you type.

## Database setup

Any PostgreSQL 14+ instance works, including Supabase.

```bash
createdb qbo_cfo
export DATABASE_URL=postgresql://postgres@localhost:5432/qbo_cfo
npm run db:migrate
```

`db/schema.sql` is written with `CREATE TABLE IF NOT EXISTS` throughout, so
re-running it is safe. It requires the `pgcrypto` extension for `gen_random_uuid()`
(created automatically if your role has permission).

For Supabase, use the connection string from *Project Settings → Database*
and append `?sslmode=require`.

## Intuit developer setup

1. Sign in at <https://developer.intuit.com> and create an app under
   **My Apps → Create an app → QuickBooks Online and Payments**.
2. Select **only** the `com.intuit.quickbooks.accounting` scope. The
   application never needs the payments scope, and never writes.
3. Open **Keys & credentials**. Use the **Development** keys for the sandbox
   and the **Production** keys for a real company.
4. Under **Redirect URIs**, add exactly the URI you will put in
   `INTUIT_REDIRECT_URI` — for local development:
   `http://localhost:3000/api/quickbooks/callback`
5. Copy the Client ID and Client Secret into `.env.local`.

### QuickBooks sandbox

Intuit provisions a sandbox company automatically. Find it under
**Dashboard → Sandboxes**. Set `INTUIT_ENVIRONMENT=sandbox` and connect from
*Settings → QuickBooks*. Full instructions, including how to enable Locations
and Classes so store reporting works, are in
[`docs/QUICKBOOKS_SETUP.md`](docs/QUICKBOOKS_SETUP.md).

### OAuth flow

```
/api/quickbooks/connect   → creates a single-use `state`, redirects to Intuit
Intuit consent screen     → user authorises read access
/api/quickbooks/callback  → validates `state`, exchanges the code, encrypts and
                            stores the tokens, fetches company information
```

Access tokens are refreshed automatically ~5 minutes before expiry, and once
more on any `401`. A failed refresh marks the connection as errored so the UI
prompts for a reconnect instead of failing silently.

## Environment variables

See [`.env.example`](.env.example) for the full annotated list.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `NEXT_PUBLIC_APP_URL` | yes | Public base URL, used to build redirects |
| `INTUIT_CLIENT_ID` | for QBO | Intuit app client id |
| `INTUIT_CLIENT_SECRET` | for QBO | Intuit app client secret — server-only |
| `INTUIT_REDIRECT_URI` | for QBO | Must match the Intuit app exactly |
| `INTUIT_ENVIRONMENT` | for QBO | `sandbox` or `production` |
| `OPENAI_API_KEY` | optional | Enables AI commentary; without it the app uses its own deterministic commentary |
| `OPENAI_MODEL` | optional | Defaults to `gpt-4.1` |
| `TOKEN_ENCRYPTION_KEY` | yes | 32 bytes, base64 or hex — encrypts OAuth tokens at rest |
| `SESSION_SECRET` | yes | Session cookie secret |
| `CRON_SECRET` | for scheduling | Bearer token required by `/api/cron/monthly` |
| `OWNER_EMAIL` / `OWNER_PASSWORD` | first run | Bootstraps the owner account during `db:migrate` |
| `DEMO_MODE` | optional | `true` enables the synthetic demo company |

Generate the secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Running locally

```bash
npm run dev          # development server
npm run build        # production build
npm run start        # production server
npm run typecheck    # strict TypeScript, no emit
npm test             # unit + integration tests
```

### Verification harnesses

Each writes its output to `docs/`, so the claim and the evidence stay together.

```bash
npm run validate:qbo    # read-only checks against a live QuickBooks company
npm run reconcile       # every total against QuickBooks' own subtotals, to the cent
npm run chat:qa         # 60 CFO chat questions -> docs/CFO_CHAT_QA.md
npm run benchmark       # timings at 50k/100k/250k transactions -> docs/PERFORMANCE.md
```

## Demo mode

With `DEMO_MODE=true` you can explore the entire product without QuickBooks:

```bash
npm run db:seed-demo -- 24     # 24 months of synthetic data
```

or press **Load demo company** on any empty page. The demo generates
QuickBooks-shaped report JSON and runs it through the *same* parsing, mapping,
metric, anomaly and reporting code as a real connection — it is a real exercise
of the product, not a set of mock screens. All names are invented; no real
customer or vendor data is used. Demo companies are clearly labelled and cannot
sync QuickBooks.

## Production deployment

Full instructions in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). In summary:

1. Provision PostgreSQL and run `npm run db:migrate`.
2. Set every environment variable above; `NEXT_PUBLIC_APP_URL` must be the real
   HTTPS origin and `INTUIT_REDIRECT_URI` must match it.
3. Register the production redirect URI on the Intuit app and switch
   `INTUIT_ENVIRONMENT=production`.
4. `npm run build && npm run start` (or deploy to any Node host).
5. Point a scheduler at the monthly endpoint (below).

## Monthly scheduler setup

Reports are generated on the **3rd of each month** by default, for the month
that just closed. Configure the day per company in *Settings → Report*.

Either call the HTTP endpoint:

```bash
curl -X POST https://your-app.example.com/api/cron/monthly \
  -H "Authorization: Bearer $CRON_SECRET"
```

or run the script from a host cron / systemd timer:

```bash
npm run cron:monthly            # every company whose scheduled day is today
npm run cron:monthly -- --force # every company, regardless of day
```

Each run: refreshes the token → pulls the closed month → validates the sync →
recomputes metrics → runs the anomaly rules → runs the CFO analysis →
generates and saves the report → marks it ready. Progress and failures are
recorded on `sync_jobs` with a retry available from the UI. V1 does not email
reports.

## Testing

```bash
npm test                                  # everything
npx vitest run --config vitest.config.mts tests/metrics.test.ts
```

- **Unit tests** cover percentage change, gross margin, YoY/YTD windows,
  account mapping, location allocation, A/R and A/P aging, anomaly thresholds,
  token refresh, data-quality scoring, the AI guardrails and the read-only
  guarantee.
- **Mock datasets** live in `tests/fixtures/mock-reports.ts` and mirror real
  Intuit report shapes.
- **Integration tests** (`tests/integration/pipeline.test.ts`) run the whole
  pipeline against a real PostgreSQL instance, including duplicate-snapshot
  prevention and PDF/XLSX rendering. They skip automatically when
  `DATABASE_URL` is unset.
- **Sandbox tests** (`tests/integration/quickbooks-sandbox.test.ts`) exercise
  the live Intuit sandbox. Run them with `QBO_SANDBOX_TESTS=1 npm test` after
  connecting a sandbox company.

## Security model

| Control | Implementation |
|---|---|
| Read-only QuickBooks access | `GET`-only client; mutating paths and non-`SELECT` queries are rejected before the request is built |
| Least-privilege scope | Only `com.intuit.quickbooks.accounting` is requested |
| Token encryption at rest | AES-256-GCM with a per-record IV, in a table separate from connection metadata |
| Client secret protection | Read only in server modules; never imported by a client component |
| OAuth CSRF protection | Single-use, expiring `state` stored server-side and validated on callback |
| Automatic token refresh | Refreshed before expiry and once on a `401`; failures mark the connection for reconnect |
| Session security | Opaque random token in an HttpOnly, SameSite=Lax, Secure cookie; only its SHA-256 is stored |
| Authentication logging | Every failed sign-in recorded, with a throttle on repeated failures |
| Tenant isolation | Every company id from a request is validated against the caller's access list |
| Rate-limit handling | `429` honours `Retry-After`; exponential backoff with full jitter |
| Retry with backoff | Up to five attempts on `429`/`5xx`/network failure |
| Input sanitisation | Zod schemas on every route; control characters stripped from free text |
| Secret redaction | The logger removes bearer tokens, OAuth tokens, client secrets and API keys |
| Audit log | Connections, syncs, mapping changes, report generation and exports |

## Documentation

| Document | Contents |
|---|---|
| [`docs/QUICKBOOKS_SETUP.md`](docs/QUICKBOOKS_SETUP.md) | Intuit app, sandbox, OAuth, which reports are pulled |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Every table, why it exists, and the traceability chain |
| [`docs/FINANCIAL_METRICS.md`](docs/FINANCIAL_METRICS.md) | Every formula, including the divide-by-zero rules |
| [`docs/AI_GUARDRAILS.md`](docs/AI_GUARDRAILS.md) | What the model may and may not do, and how it is enforced |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Production deployment and operations |
| [`docs/PRODUCTION_CHECKLIST.md`](docs/PRODUCTION_CHECKLIST.md) | The gates to clear before a real company's month-end runs on this |
| [`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md) | Threat by threat, with the test that exercises each control |
| [`docs/BACKUP_RECOVERY.md`](docs/BACKUP_RECOVERY.md) | What is at risk, backup schedule, restore procedure, recovery objectives |
| [`docs/SANDBOX_VS_PRODUCTION.md`](docs/SANDBOX_VS_PRODUCTION.md) | How Intuit's sandbox differs from a real company, and how each difference is handled |
| [`docs/RECONCILIATION.md`](docs/RECONCILIATION.md) | The latest reconciliation run, line by line |
| [`docs/CFO_CHAT_QA.md`](docs/CFO_CHAT_QA.md) | 60 chat questions with the answers the application actually gave |
| [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) | Measured timings at 50k, 100k and 250k transactions |
| [`docs/BUILD_STATUS.md`](docs/BUILD_STATUS.md) | Production-readiness gates, what is built, and known issues |

## Production readiness

**This build has never been run against a production QuickBooks company.**
`docs/BUILD_STATUS.md` records which gates are met and which are not, and
`docs/PRODUCTION_CHECKLIST.md` is the path from here to yes. Do not run a real
company's month-end on it until the live validation and reconciliation gates
pass.

---

This application produces management information. It is not an audit, a tax
opinion, or a substitute for review by a CPA.
