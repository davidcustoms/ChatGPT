# Build Status

Last updated: 2026-08-23

---

## Completed

### Phase 1 — Foundation
- Next.js 16 / React 19 / TypeScript (strict, `noUncheckedIndexedAccess`) / Tailwind v4 project
- PostgreSQL schema (`db/schema.sql`), idempotent, with an application script (`npm run db:migrate`)
- Session authentication: opaque tokens, HttpOnly cookies, only the SHA-256 stored, failed-login throttle
- Application shell: sidebar navigation, company switcher, reporting-month picker, error boundary, 404
- QuickBooks OAuth 2.0: connect, callback with single-use state validation, disconnect with revoke, reconnect
- AES-256-GCM token encryption at rest; automatic refresh with failure handling

### Phase 2 — QuickBooks sync
- Read-only API client: `GET` only, mutating endpoints and non-`SELECT` queries rejected, `429` backoff honouring `Retry-After`, `5xx` and network retry with full jitter, one automatic token refresh on `401`
- Company information, chart of accounts, vendors, customers, items, classes, locations
- Reports: Profit & Loss, Balance Sheet, Cash Flow, Aged Receivables, Aged Payables, and a P&L summarised by Location or Class
- Ten transaction entity types with line detail
- Raw snapshots stored verbatim with source metadata; unique per company/type/period/dimension
- Historical import of 12 / 24 / 36 / custom months with per-month progress and partial-failure reporting

### Phase 3 — Financial engine
- Management category taxonomy (22 built-in categories, custom categories supported); no account names hard-coded anywhere
- Mapping suggestion engine: QuickBooks sub-type first, then account-name keywords, then account-type fallback; anything below 0.90 confidence stays pending until the owner approves it
- Monthly metric computation from stored snapshots, with contra-revenue handling and unmapped-expense tracking
- KPI engine (25 measures) with `null`-on-undefined-denominator throughout
- Comparisons: prior month, same month last year, YTD, prior YTD, trailing 12 — with fiscal-year support
- Location/class metrics with explicit unallocated-overhead labelling
- Changing a mapping recomputes every stored month from snapshots, without a QuickBooks call

### Phase 4 — Dashboard
- KPI cards with month / YoY / YTD / trailing-12 comparison selector
- Revenue and profit trend, gross margin, cash, payroll and advertising ratios, expense breakdown, store comparison, A/R and A/P aging
- Charts follow a validated, colour-vision-safe palette; every chart ships a legend and an accessible data table
- "Needs Your Attention" ranked alert panel

### Phase 5 — Anomaly engine
- 19 deterministic rules, every threshold configurable per company
- Severity and ranking score combining threshold distance, dollar impact and impact relative to revenue
- Transactions Needing Attention: large, above-pattern, unknown payee, uncategorised, duplicate-looking, round-dollar, weekend, owner distributions, transfers and refunds
- Monthly close checklist with a High / Medium / Low Report Confidence score

### Phase 6 — AI CFO
- Labelled metric context with an allow-list of every quotable figure
- Structured CFO insights (category, severity, observation, supporting metrics, implication, action, confidence)
- Hallucination filter: an insight quoting an unsupplied dollar amount is dropped; a bad summary is replaced
- Deterministic fallback so reports complete without an API key
- Ask Your CFO: rule-based intent classification, database resolution, model narration, with the period and source shown on every answer

### Phase 7 — Reports
- Twelve-section monthly report rendered on screen
- Polished 13-page PDF (white background, navy typography, KPI cards, tables)
- Twelve-sheet XLSX with live formulas for changes and ratios
- Report history with status, confidence and per-report exports

### Phase 8 — Automation
- Monthly job: refresh → sync → validate → metrics → anomalies → AI → generate → save → mark ready
- `POST /api/cron/monthly` protected by a constant-time shared-secret check, plus `npm run cron:monthly`
- Job status, step-level progress, warnings and retry surfaced in the UI
- Snapshot retention pruning during the monthly run

### Cross-cutting
- Demo mode: 24 months of synthetic multi-store furniture-retail data that flows through the real pipeline
- Onboarding wizard whose step completion is derived from real state
- Source traceability: drill-down from a category total to accounts, transactions and QuickBooks ids
- Audit log for connections, syncs, mapping changes, report generation and exports
- Typed error taxonomy with retryability and user-facing recovery guidance
- 243 tests: unit, mock-dataset, database integration, and an Intuit sandbox suite

---

## In progress

Nothing. Phases 1–8 are complete and verified against a live PostgreSQL
instance with the demo dataset.

---

## Remaining (deliberately out of scope for V1)

Architecture is in place for these; none is implemented.

- Email, Slack and SMS delivery of reports
- Multiple QuickBooks companies with consolidated reporting (the schema supports
  many companies per user; consolidation logic is not written)
- Budget vs actual, forecasting, forecasted cash and revenue
- Inventory and purchase-order analytics beyond quantity-on-hand checks
- Bank transaction review, daily sales dashboard, weekly reports
- CPA portal and multi-user roles beyond the owner (`company_members` and
  `users.role` exist; no UI)
- Vendor price-trend analysis
- **Write-back to QuickBooks — intentionally excluded.** The client is
  structurally read-only.

---

## Known issues and limitations

| Area | Limitation |
|---|---|
| Cash flow statement | QuickBooks does not return one for every company or period. The split is then omitted rather than estimated, and the report says so |
| Bank reconciliation | Intuit's API does not expose reconciliation status, so the close checklist surfaces a manual reminder rather than a verified check |
| Store overhead | Shared corporate expenses are not allocated to stores. Every store figure is labelled *Store Contribution Before Corporate Overhead* |
| Long imports | A 36-month import can take several minutes and runs synchronously. On serverless platforms with a hard request ceiling, import 12 months at a time |
| Vendor spend | Derived from stored transactions, so it depends on the transaction sync completing for the month |
| Accounting method | Reports are pulled on an accrual basis. Cash-basis reporting is not yet selectable |
| Multi-currency | Single currency per company. QuickBooks multi-currency companies report in home currency only |
| Chat coverage | Fifteen question shapes are supported; anything else returns an explicit "not supported" answer rather than a guess |
| Token key rotation | `oauth_tokens.key_version` exists, but no rotation routine is implemented; changing `TOKEN_ENCRYPTION_KEY` requires reconnecting |

---

## Verification performed

- `npm run typecheck` — clean under strict TypeScript
- `npm run build` — production build succeeds
- `npm test` — 243 tests pass (4 sandbox tests skip without live credentials)
- End-to-end run against a live PostgreSQL instance: migrate → seed 24 months →
  compute metrics → detect anomalies → generate report → render a 13-page PDF
  and a 12-sheet workbook
- Every page rendered as a signed-in user (200, non-trivial payload) and
  inspected visually
- Authorisation verified: anonymous users are redirected or receive `401`; a
  second user receives `403` on another tenant's company, report, drill-down and
  sync endpoints; the cron endpoint rejects a missing or wrong secret
