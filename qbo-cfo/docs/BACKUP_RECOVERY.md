# Backup and recovery

Everything this application knows lives in one PostgreSQL database. There is no
other state: no local files, no cache that matters, no queue. That makes the
recovery story simple, and it makes the backup story the whole story.

---

## What is at risk, and how badly

| Data | Recoverable from QuickBooks? | Consequence of loss |
|---|---|---|
| Raw report snapshots (`report_snapshots`) | Yes, by re-syncing — **but only as they look today** | Historical restatements in QuickBooks are silently lost. A prior month re-pulled after the books were edited will not match the report you issued |
| Derived metrics (`monthly_metrics`, `monthly_account_metrics`, `monthly_location_metrics`, `monthly_vendor_spend`) | Yes, recomputed from snapshots | None, if snapshots survive |
| Transactions and lines | Yes, by re-syncing | Vendor analysis and drill-down are unavailable until the re-sync finishes |
| **Account mappings** (`account_mappings`, `account_mapping_versions`) | **No** | Every category assignment the owner made by hand is gone. This is the single most expensive thing to lose |
| **Generated reports and versions** (`generated_reports`, `report_versions`, `ai_insights`) | **No** | The reports that were actually issued cannot be reproduced byte-for-byte. Report versioning exists precisely so this history is authoritative |
| Anomaly thresholds, branding, schedules | No | Configuration must be re-entered |
| Chat history (`chat_messages`) | No | Conversation record lost; no financial impact |
| OAuth tokens (`oauth_tokens`) | No, but replaceable | Reconnect QuickBooks through the UI |
| Audit log (`audit_logs`) | No | Compliance record lost |

The two rows in bold are why "we can just re-sync from QuickBooks" is not a
backup strategy.

---

## Backup

### What to back up

The database, and `TOKEN_ENCRYPTION_KEY`.

A database backup without the encryption key leaves `oauth_tokens` unreadable —
recoverable only by reconnecting QuickBooks. Store the key in your secret
manager, not in the backup.

### Managed Postgres (Supabase, RDS, Neon, Cloud SQL)

Enable **point-in-time recovery** and set the retention window to at least 30
days — long enough to notice that a month's figures went wrong and roll back
past it. Automated daily snapshots alone are not enough: the failure mode that
matters here is a bad mapping change or a botched import that is only noticed
at the next month end.

Verify the provider's retention is what you think it is; several default to
7 days.

### Self-hosted

```bash
# Nightly logical backup, compressed and timestamped
pg_dump --format=custom --no-owner --no-privileges \
  --file "qbo-cfo-$(date -u +%Y%m%dT%H%M%SZ).dump" "$DATABASE_URL"
```

For point-in-time recovery, also enable WAL archiving (`archive_mode = on`,
`archive_command` writing to durable off-host storage). A nightly dump alone
means up to 24 hours of loss.

Ship backups off the database host. A backup on the same volume protects
against nothing that actually happens.

### Schedule

| Frequency | Method | Retention |
|---|---|---|
| Continuous | WAL archiving / provider PITR | 30 days |
| Nightly | `pg_dump` custom-format | 30 daily |
| Monthly, after close | `pg_dump` retained separately | 7 years, to match accounting record retention |

The monthly post-close copy matters: it is the one that proves what the books
said when the report was issued.

### Before anything risky

Take an explicit backup before a bulk mapping change, a schema upgrade, or a
historical re-import:

```bash
pg_dump --format=custom --file "before-mapping-change.dump" "$DATABASE_URL"
```

---

## Restore

### Full restore

```bash
createdb qbo_cfo_restored
pg_restore --no-owner --no-privileges --dbname qbo_cfo_restored qbo-cfo-20260801T030000Z.dump

# Point the application at the restored database and re-apply the schema
# (idempotent; it will be a no-op on a current dump).
DATABASE_URL=postgresql://.../qbo_cfo_restored npm run db:migrate
```

Then:

1. Sign in and confirm the company list, the latest report, and the mapping
   coverage panel.
2. Run `npm run reconcile` for the most recent closed month. Every line must
   read `MATCH`. If it does not, the restore is not complete — do not issue
   reports from it.
3. Reconnect QuickBooks if `TOKEN_ENCRYPTION_KEY` changed, or if the tokens in
   the backup have expired (refresh tokens last 100 days).

### Restoring one table

Most real incidents are narrow — a mapping change that wrecked a category, an
import that wrote bad figures for one month. Restore the affected table into a
scratch schema and copy rows across rather than rolling the whole database
back:

```bash
pg_restore --no-owner --dbname qbo_cfo --table account_mappings --data-only \
  --schema public backup.dump
```

After restoring mappings, recompute the affected months so derived figures
follow the restored mapping:

```bash
npm run cron:monthly -- --company <uuid>    # or use Recompute in Settings → Mappings
```

### Recovering from a bad import without a restore

Derived metrics are a pure function of the stored snapshots and the current
mapping. If the snapshots are intact, no restore is needed:

- **Settings → Mappings → Recompute** replays every stored month against the
  current mapping. It makes no QuickBooks calls.
- `recomputeMonth()` does the same for a single month.

If the *snapshots* are wrong (a partial sync, a QuickBooks outage mid-import),
re-sync that month. Snapshots are keyed on
`(company, report type, dimension, period, basis)`, so a re-sync replaces
rather than accumulates — verified by `tests/integration/idempotency.test.ts`,
which syncs the same month ten times and asserts the stored rows are identical.

---

## Recovery objectives

| Objective | Target | What delivers it |
|---|---|---|
| RPO (data loss) | 5 minutes | WAL archiving / provider PITR |
| RPO without PITR | 24 hours | Nightly dump |
| RTO (time to serve) | 1 hour | `pg_restore` of a single-tenant database is minutes; the hour is for verification |
| Time to trust the figures | + 15 minutes | `npm run reconcile` on the latest closed month |

The application itself is stateless. Redeploying it is not part of recovery
beyond pointing `DATABASE_URL` at the restored database.

---

## Testing the backup

An untested backup is a hypothesis. Quarterly:

1. Restore the most recent nightly dump into a scratch database.
2. Run `npm run db:migrate` against it (must be a no-op).
3. Run `npm test` with `DATABASE_URL` pointed at it.
4. Run `npm run reconcile` for the latest closed month and confirm `PASS`.
5. Record the date and the wall-clock restore time.

If step 4 fails, the backup is not usable for financial reporting regardless of
what steps 1–3 said.

---

## Key rotation

`oauth_tokens.key_version` exists so `TOKEN_ENCRYPTION_KEY` can be rotated, but
no rotation routine is implemented. Changing the key today invalidates stored
tokens and requires reconnecting QuickBooks through the UI. No accounting data
is affected — snapshots, metrics, mappings and reports are not encrypted with
that key.

---

## What is deliberately not backed up

- **Generated PDF and XLSX files.** They are not stored; they are rendered on
  demand from the report payload. Restoring the database restores the ability
  to regenerate any historical report exactly, because `report_versions` holds
  the payload, the source fingerprint, the mapping version and the prompt
  version that produced it.
- **The demo company.** Reseed it with `npm run db:seed-demo`.
