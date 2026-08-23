# Data Model

PostgreSQL schema, in `db/schema.sql`. Every table exists to support one of
three guarantees: **reproducibility** (any figure can be recomputed from stored
raw data), **traceability** (any figure can be traced back to the QuickBooks
object it came from), and **isolation** (one company's data is never visible to
another tenant).

---

## Conventions

- Money is `NUMERIC(18,2)`; ratios are `NUMERIC(12,6)`. Never a floating point
  type — a test asserts this against the schema file.
- Ratios are stored as ratios (`0.45`), not percentages, and formatted at the
  edge.
- Every table that holds financial data carries `company_id` and cascades on
  delete.
- Periods are stored as `period_start` / `period_end` `DATE` pairs, always a
  full calendar month.
- `pg` returns `NUMERIC` as a string; repositories convert at their boundary so
  precision is never lost to an implicit float.

---

## Identity and tenancy

### `users`
Owner and future team members. `password_hash` is scrypt with a per-record
salt. `role` is one of `owner`, `admin`, `analyst`, `viewer`.

### `sessions`
Opaque, database-backed sessions. Only `token_hash` (SHA-256 of the cookie
value) is stored, so a database leak cannot be replayed as a login.

### `companies`
One row per QuickBooks realm, plus the synthetic demo company. Holds reporting
configuration that is *not* QuickBooks data: fiscal year start, currency,
`tracking_dimension` (`auto` | `location` | `class` | `none`) and the
materiality thresholds (`materiality_amount`, `materiality_pct`).

### `company_members`
Additional users per company. The schema supports multiple users from day one
even though V1 ships with a single owner.

---

## QuickBooks connection

### `quickbooks_connections`
Company ↔ realm link with `status`, `environment`, the QuickBooks company name,
`last_sync_at`, `last_report_at` and `last_error`. Unique on
`(company_id, realm_id)` so reconnecting updates rather than duplicates.

### `oauth_tokens`
Separate table so ordinary connection queries never load ciphertext. One row per
connection (`connection_id UUID NOT NULL UNIQUE`). Columns are
`access_token_encrypted` and `refresh_token_encrypted` — AES-256-GCM,
`v1:<iv>:<tag>:<ciphertext>` — plus absolute expiry instants, granted scopes,
`key_version` for future key rotation and `refresh_failure_count`.

### `oauth_states`
Single-use CSRF state for the authorize round-trip. Stores the SHA-256 of the
state, an `expires_at` and a `consumed_at`. The callback consumes it with a
conditional `UPDATE … RETURNING`, so a replay finds nothing and is rejected.

---

## Mirrored master data

`accounts`, `customers`, `vendors`, `items`, `classes`, `locations` — read-only
copies of QuickBooks entities, each unique on `(company_id, qbo_id)` so a
re-sync updates in place.

`accounts` keeps `account_type` and `account_sub_type` verbatim. These stable
Intuit enumerations — not account names — are what the statement parser
classifies on, which is why renaming an account in QuickBooks never breaks a
report.

`locations` additionally carries `display_name` and `is_store`: owner-facing
settings that affect reporting only and are never written back.

---

## Transactions

### `transactions` / `transaction_lines`
Header and line detail for the transaction types the application reads. Unique
on `(company_id, txn_type, qbo_id)`. These power vendor spend, the review
queue, duplicate detection, dimension-coverage checks and metric drill-down.

Lines carry `account_qbo_id`, `class_qbo_id`, `location_qbo_id` and
`customer_qbo_id` so a category total can be decomposed all the way to
individual postings.

---

## Raw snapshots

### `report_snapshots`
The audit trail: exactly what QuickBooks returned, stored as `JSONB`, with
`source_system`, `source_realm_id`, `source_fetched_at` and the `sync_job_id`
that fetched it.

```sql
UNIQUE (company_id, report_type, period_start, period_end, dimension, accounting_method)
```

This constraint is what makes a re-import idempotent: `saveSnapshot` upserts, so
importing the same month twice updates one row instead of creating a second.
Every derived number can be recomputed from these rows without contacting Intuit
again — which is exactly what happens when an account mapping changes.

---

## Mapping layer

### `management_categories`
Custom categories per company. The built-in taxonomy lives in code
(`src/lib/finance/categories.ts`); this table holds additions and overrides.

### `account_mappings`
`(company_id, account_qbo_id)` → `category_key`, with `confidence`, `source`
(`manual` | `suggested` | `default`), `approved`, `suggested_reason` and who
approved it.

Only mappings that are **approved**, or suggested with confidence ≥ 0.90, are
applied by the metric engine. A low-confidence guess sits pending until the
owner approves it, so an uncertain suggestion never silently moves money between
categories.

---

## Computed metrics

### `monthly_metrics`
One row per company-month: the full income statement (gross sales, discounts,
returns, net sales, COGS, gross profit and margin, every named expense bucket,
operating income, other income and expense, net income and margin) and the
balance sheet (cash, A/R, A/P, inventory, current assets, fixed assets, total
assets, credit cards, short- and long-term debt, current and total liabilities,
equity).

It also stores its own quality signals — `unmapped_opex_amount`,
`unmapped_opex_pct`, `balance_sheet_balanced` — and `source_snapshot_ids`,
the snapshots the row was computed from.

```sql
UNIQUE (company_id, period_start, period_end)
```

### `monthly_account_metrics`
Per-account amounts for a month, with the category each was mapped to. Powers
expense analysis, drill-down and uncategorised-balance detection.

### `monthly_location_metrics`
Per-store results with an explicit `overhead_allocated` flag, which is always
`false` in V1. That flag is why every store figure in the product is labelled
**Store Contribution Before Corporate Overhead**.

### `monthly_vendor_spend`
Vendor totals per month, aggregated from `transactions`.

### `aging_snapshots`
A/R and A/P buckets as of a date, one row per entity plus a `__TOTAL__` roll-up.

---

## Analysis and output

### `anomaly_thresholds`
Per-company overrides of the deterministic rule parameters. Defaults live in
`src/lib/finance/anomaly-rules.ts`; this table only stores what an owner changed.

### `anomalies`
Findings for a period: rule key, severity, category, title, detail, the values
that triggered it, a ranking `score` and the JSON evidence. Unique on
`(company_id, period_start, rule_key, title)`.

### `generated_reports`
One report per company-month, with `status`
(`pending` → `syncing` → `analyzing` → `generating` → `completed` | `failed`),
`confidence`, `confidence_reasons`, the complete `payload`, and the executive
summary. Unique on `(company_id, period_start, period_end)` — regenerating a
month reuses the row rather than accumulating duplicates.

### `report_sections`
The report broken into its lettered sections, so a section can be re-rendered or
re-narrated without rebuilding the whole payload.

### `ai_insights`
Structured CFO commentary: category, severity, observation, supporting metrics,
likely implication, recommended action, confidence and the model that produced
it. Stored separately from the deterministic payload so insights can be
regenerated without recomputing any figure.

### `chat_messages`
"Ask Your CFO" history, including the resolved intent, the verified JSON the
answer was computed from, and the `data_through` date shown with the answer.

---

## Operations

### `sync_jobs`
Progress and outcome for every sync, historical import, demo seed and monthly
run: `status`, `progress_current` / `progress_total`, `current_step`, a `steps`
array, `error_message` and `retry_count`.

### `audit_logs`
Append-only record of connections, token refreshes, syncs, mapping changes,
report generation and exports, with the acting user, IP, user agent and JSON
metadata. Writes never throw into the caller's path — an audit failure must not
mask the operation's real result.

### `auth_failures`
Failed sign-ins, used both for investigation and for the repeated-failure
throttle on the login form.

### `report_branding` / `report_schedules`
Branding (name, logo data URL, title template, colour, footer, confidential
flag) and the schedule (enabled, day of month, timezone, retention months, last
run).

---

## Traceability chain

Any figure in a report can be walked back to source:

```
report payload figure
  → monthly_metrics             (company-month totals)
  → monthly_account_metrics     (which accounts contributed)
  → accounts                    (QuickBooks account id, number, type)
  → transaction_lines           (individual postings)
  → transactions                (QuickBooks transaction id, date, vendor, doc #)
  → report_snapshots            (the exact JSON QuickBooks returned)
```

`GET /api/drilldown?company=…&period=YYYY-MM&category=…` returns the middle of
that chain directly, and the Expenses page renders it.

---

## Retention

`report_schedules.retention_months` (default 36) controls pruning of raw
snapshots during the monthly run. Computed monthly metrics are never pruned, so
long-run trends survive even after the underlying raw JSON is removed.
