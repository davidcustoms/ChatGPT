# Sandbox vs production QuickBooks

**Status: not yet run against a production QuickBooks company.**

This document has two parts. The first is what the application already knows
about how Intuit's sandbox differs from a real company, encoded as checks in
`scripts/validate-live-qbo.ts`. The second is the empty table that run fills
in. Until that table has entries, nobody should treat this application as
validated against production data.

---

## Running the validation

```bash
# 1. Configure production credentials (see docs/QUICKBOOKS_SETUP.md)
INTUIT_ENVIRONMENT=production
INTUIT_CLIENT_ID=...
INTUIT_CLIENT_SECRET=...
INTUIT_REDIRECT_URI=https://your-host/api/quickbooks/callback

# 2. Connect the company through the UI — the OAuth consent screen needs a human
npm run dev
# visit /settings/quickbooks and complete the Intuit consent flow

# 3. Run the harness
npm run validate:qbo
npm run validate:qbo -- --json > validation.json    # machine-readable
```

The harness is **strictly read-only**. It issues `GET` requests only, and it
actively attempts four mutating request shapes to prove the client refuses
them. It never writes to QuickBooks.

Exit code is `1` if any check fails.

---

## What the harness checks

| Area | Check |
|---|---|
| Environment | `INTUIT_ENVIRONMENT` is `production`; all four Intuit variables are set |
| Connection | A connection row exists, with a realm id and an unexpired refresh token |
| Tokens | Access token is decryptable, refresh succeeds, the new token is stored encrypted |
| Company | `CompanyInfo` returns a name, country and fiscal year start |
| Chart of accounts | Every account has an id, name and type; sub-type coverage is measured |
| Master data | Vendors, customers, items, classes and locations page correctly |
| Statements | P&L, Balance Sheet and Cash Flow for each of the last three closed months |
| Aging | Aged Receivables and Aged Payables as of each month end |
| Dimensions | P&L summarised by Location, then by Class |
| Transactions | All ten transaction entity types for one month, with line detail |
| Balance sheet identity | Assets = Liabilities + Equity, to the cent, for every month pulled |
| Read-only guarantee | Four mutating endpoint shapes are attempted and must all be refused |

---

## Differences already anticipated in code

These are handled defensively today. Each one is a place where a sandbox
company is more generous than a real one, and each is surfaced by the harness
as a `DIFFERENCE` line rather than a silent fallback.

| # | Sandbox behaviour | Production risk | How the application handles it |
|---|---|---|---|
| 1 | `FiscalYearStartMonth` is always returned | A real company may omit it | Falls back to the fiscal year configured in Settings, and says so |
| 2 | Every account carries an `AccountType` | Real charts contain accounts with no type | Classification falls back to the report section; the harness reports how many accounts are affected |
| 3 | Every account carries an `AccountSubType` | Real charts are inconsistent | Mapping suggestions fall back to name keywords, at lower confidence, and stay pending for approval |
| 4 | `CashFlow` is returned for every period | Many real companies cannot produce it | The cash flow split is **omitted rather than estimated**, and the report states that |
| 5 | Locations and Classes are enabled | Most real companies use one, or neither | `resolveTrackingDimension` detects which exists and falls back to a single unallocated line |
| 6 | Aging reports are always available | May be empty or unavailable | Aging sections read "not captured for this period" rather than showing zeros |
| 7 | Small, tidy datasets | 250k+ transactions, deep account trees | Paged reads, batched writes; see `docs/PERFORMANCE.md` |
| 8 | Few or no duplicate ids across pages | Real page sets can repeat an id | The upsert dedupes within a batch before writing |
| 9 | No rate limiting in practice | Production enforces per-realm limits | `429` is retried with backoff honouring `Retry-After` |
| 10 | Tokens rarely expire mid-session | Access tokens last one hour | One automatic refresh on `401`, then a typed reconnect error |

---

## Observed differences

*To be completed by the first production run. Do not fill this in from
expectation — only from harness output.*

| # | Area | Sandbox | Production | Impact | Action taken |
|---|---|---|---|---|---|
| | | | | | |

---

## Reconciliation against the production company

After the harness passes, reconcile the figures:

```bash
npm run reconcile -- --period 2026-07 --markdown docs/RECONCILIATION.md
```

Every line must read `MATCH` with a `$0.00` difference. A difference is a bug
in the data transformation and must be fixed there — never by adjusting a
tolerance. See `docs/RECONCILIATION.md` for the current run.
