# Production checklist

Work top to bottom. The gates marked **BLOCKING** must pass before this
application produces a report anyone relies on.

Current status of the blocking gates is tracked in `docs/BUILD_STATUS.md`.

---

## 1. Infrastructure

- [ ] PostgreSQL 15+ provisioned, reachable from the application over TLS
- [ ] `DATABASE_URL` uses a role with `SELECT`/`INSERT`/`UPDATE`/`DELETE` on the
      application schema and no superuser rights
- [ ] Connection pool sized for the platform (serverless: use the provider's
      pooler, not a direct connection)
- [ ] Point-in-time recovery enabled with **at least 30 days** retention
      (see `docs/BACKUP_RECOVERY.md`)
- [ ] A restore has been performed into a scratch database and verified with
      `npm run reconcile`
- [ ] Application runs behind TLS; HTTP redirects to HTTPS
- [ ] `npm run db:migrate` applied; it is idempotent and safe to re-run

## 2. Secrets

Generate each key fresh for production. Never reuse a development value.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

- [ ] `TOKEN_ENCRYPTION_KEY` — 32 bytes, generated for production, stored in a
      secret manager, **backed up separately from the database**
- [ ] `SESSION_SECRET` — 32 bytes, generated for production
- [ ] `CRON_SECRET` — long random string; the scheduler endpoint refuses all
      requests when this is unset
- [ ] `OWNER_PASSWORD` — used once to bootstrap, then changed and removed from
      the environment
- [ ] `INTUIT_CLIENT_SECRET` — production credential, never in client code
- [ ] `OPENAI_API_KEY` — optional; without it the application produces every
      figure and a deterministic commentary, and says AI narration is disabled
- [ ] No secret is committed. `.env.local` is gitignored; `.env.example` holds
      placeholders only

## 3. QuickBooks connection

Full walkthrough: [`INTUIT_PRODUCTION_SETUP.md`](INTUIT_PRODUCTION_SETUP.md).


- [ ] `INTUIT_ENVIRONMENT=production`
- [ ] `INTUIT_REDIRECT_URI` matches a redirect URI registered on the Intuit app
      **exactly**, including scheme, host, port and path
- [ ] The Intuit app requests `com.intuit.quickbooks.accounting` only
- [ ] The company has been connected through the UI by a human completing the
      Intuit consent screen
- [ ] The QuickBooks user whose grant this is has read access to every entity
      the reports need (accounts, vendors, customers, items, classes/locations,
      transactions)

## 4. Data validation — **BLOCKING**

- [ ] `npm run validate:live` (or `/validation/live-qbo`) reports
      **Production Ready: YES** — all fourteen gate criteria pass
- [ ] `npm run validate:qbo` passes with `INTUIT_ENVIRONMENT=production`
- [ ] Every difference the harness reports is recorded in
      `docs/SANDBOX_VS_PRODUCTION.md` with the action taken
- [ ] History imported: at least 24 months, ideally 36
- [ ] `npm run reconcile -- --period <latest closed month>` reports
      **`RESULT: PASS`** with every line `MATCH` and `$0.00` difference
- [ ] Reconciliation repeated for two further months, including one month that
      crosses a fiscal year boundary
- [ ] Any difference was fixed **in the data transformation**, never by
      widening a tolerance or hiding a line

## 5. Account mapping — **BLOCKING**

- [ ] Every income and expense account is reviewed in Settings → Mappings
- [ ] Mapping coverage is **95% or higher** by dollar value in both the income
      and expense sections
- [ ] No management category the reports discuss shows Low confidence
- [ ] The mapping is captured as a version (automatic after import; visible in
      the mapping history)
- [ ] Uncategorised balances are either mapped or understood

## 6. Reporting basis

- [ ] Settings → Company → Accounting method matches how the owner and their
      CPA read the books (Accrual or Cash)
- [ ] The basis badge is visible on the dashboard, the report, the PDF, the
      workbook and the CFO chat
- [ ] After changing the basis, history is re-imported — figures on two bases
      are never mixed within a report

## 7. Data quality

- [ ] The report's confidence score is **75 or higher** (Good or Excellent)
- [ ] Every deduction on the score is understood; none is a surprise
- [ ] The monthly close checklist has no unexplained warning
- [ ] The balance sheet balances for every imported month

## 8. Security — **BLOCKING**

- [ ] `docs/SECURITY_REVIEW.md` has been read and its accepted limitations are
      acceptable for this deployment
- [ ] `npm test` passes, including the security and prompt-injection suites
- [ ] A second user account cannot reach the first user's company, reports,
      exports or drill-downs (covered by the test suite; spot-check in the UI)
- [ ] `/api/cron/monthly` returns `401` without the secret and `403` when
      `CRON_SECRET` is unset
- [ ] `/api/health` returns no secret value — only booleans, versions and status
- [ ] Logs are inspected once in production for token material; there should be
      none, and `redact()` is the backstop

## 9. Scheduling

- [ ] A scheduler calls `POST /api/cron/monthly` with
      `Authorization: Bearer $CRON_SECRET`
- [ ] It runs after the books are typically closed — the 5th of the month or
      later, not the 1st
- [ ] The platform's request timeout exceeds the run time. On serverless with a
      hard ceiling, trigger per-company runs (`?company=<uuid>`) instead of the
      all-companies sweep
- [ ] A failed run is visible: check the job history after the first scheduled
      execution

## 10. Observability

- [ ] `/api/health` is wired to the platform's health check; `503` takes the
      instance out of rotation
- [ ] Application logs are shipped somewhere durable and searchable
- [ ] Alerts on: `sync.failed`, `report.failed`, `qbo.token_refresh_failed`,
      `ai.injection_signal`
- [ ] The audit log is retained for as long as the accounting records are

## 11. Performance

- [ ] `docs/PERFORMANCE.md` figures are acceptable for the company's transaction
      volume
- [ ] For a first import above ~100k transactions, the import is run outside a
      request-timeout-bounded context (a worker or a local run against the
      production database)

## 12. Before handing it to the owner

- [ ] Bootstrap owner password changed; `OWNER_PASSWORD` removed from the
      environment
- [ ] Demo mode disabled (`DEMO_MODE=false`) or the demo company deleted, so no
      synthetic figure can be mistaken for a real one
- [ ] Branding set: business name, logo, primary colour, footer
- [ ] Materiality thresholds set to amounts that mean something for this
      business
- [ ] Anomaly thresholds reviewed — the defaults are a starting point, not a
      calibration
- [ ] One report generated end to end, opened as a PDF and as a workbook, and
      read by someone who knows the business
- [ ] The owner has been told, in plain words: this is management information
      derived from QuickBooks, on the stated basis, and it is not an audit or a
      substitute for their CPA

---

## Post-deployment, first month

- [ ] The scheduled run fired and produced a report without manual help
- [ ] The report's figures were checked against QuickBooks by the owner or
      their bookkeeper
- [ ] "Ask Your CFO" was used for real questions and gave answers the owner
      could act on
- [ ] A backup restore was tested at least once
- [ ] `docs/SANDBOX_VS_PRODUCTION.md` reflects what was actually observed
