-- ===========================================================================
-- QuickBooks Online CFO Reporting Agent -- PostgreSQL schema
--
-- Design notes:
--  * Every financial fact carries source metadata (source_system, source_id,
--    source_fetched_at) so any number in a report can be traced back to the
--    QuickBooks object it came from.
--  * Money is stored as NUMERIC(18,2); ratios as NUMERIC(12,6). Never float.
--  * The application is READ-ONLY with respect to QuickBooks. Nothing in this
--    schema records intent to write back to Intuit.
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- --------------------------------------------------------------------------
-- Identity
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT        NOT NULL UNIQUE,
  password_hash   TEXT        NOT NULL,
  display_name    TEXT,
  role            TEXT        NOT NULL DEFAULT 'owner'
                    CHECK (role IN ('owner', 'admin', 'analyst', 'viewer')),
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,
  user_agent  TEXT,
  ip_address  TEXT,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

-- --------------------------------------------------------------------------
-- Companies (a company == one QuickBooks realm, or the synthetic demo company)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT        NOT NULL,
  legal_name         TEXT,
  country            TEXT,
  fiscal_year_start_month SMALLINT NOT NULL DEFAULT 1
                       CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  currency_code      TEXT        NOT NULL DEFAULT 'USD',
  is_demo            BOOLEAN     NOT NULL DEFAULT FALSE,
  -- reporting / analysis configuration
  tracking_dimension TEXT        NOT NULL DEFAULT 'auto'
                       CHECK (tracking_dimension IN ('auto','location','class','none')),
  materiality_amount NUMERIC(18,2) NOT NULL DEFAULT 1000,
  materiality_pct    NUMERIC(12,6) NOT NULL DEFAULT 0.10,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS companies_owner_idx ON companies(owner_user_id);

CREATE TABLE IF NOT EXISTS company_members (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'viewer'
               CHECK (role IN ('owner','admin','analyst','viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);

-- --------------------------------------------------------------------------
-- QuickBooks connection + encrypted OAuth tokens
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quickbooks_connections (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  realm_id           TEXT        NOT NULL,
  environment        TEXT        NOT NULL DEFAULT 'sandbox'
                       CHECK (environment IN ('sandbox','production')),
  status             TEXT        NOT NULL DEFAULT 'connected'
                       CHECK (status IN ('connected','disconnected','error','revoked')),
  qbo_company_name   TEXT,
  qbo_legal_name     TEXT,
  qbo_country        TEXT,
  qbo_fiscal_year_start_month SMALLINT,
  last_error         TEXT,
  last_sync_at       TIMESTAMPTZ,
  last_report_at     TIMESTAMPTZ,
  connected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  disconnected_at    TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, realm_id)
);
CREATE INDEX IF NOT EXISTS qbo_conn_realm_idx ON quickbooks_connections(realm_id);

-- Tokens live in their own table so they can be revoked/rotated independently
-- and so that ordinary connection queries never load ciphertext.
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id          UUID        NOT NULL UNIQUE
                           REFERENCES quickbooks_connections(id) ON DELETE CASCADE,
  access_token_encrypted TEXT        NOT NULL,
  refresh_token_encrypted TEXT       NOT NULL,
  access_token_expires_at  TIMESTAMPTZ NOT NULL,
  refresh_token_expires_at TIMESTAMPTZ,
  token_type             TEXT        NOT NULL DEFAULT 'bearer',
  scopes                 TEXT[]      NOT NULL DEFAULT '{}',
  key_version            SMALLINT    NOT NULL DEFAULT 1,
  last_refreshed_at      TIMESTAMPTZ,
  refresh_failure_count  INTEGER     NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Short-lived OAuth state values (CSRF protection for the authorize round-trip)
CREATE TABLE IF NOT EXISTS oauth_states (
  state       TEXT PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id  UUID        REFERENCES companies(id) ON DELETE CASCADE,
  redirect_to TEXT,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- Master data mirrored from QuickBooks (read-only copies)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  qbo_id            TEXT NOT NULL,
  name              TEXT NOT NULL,
  fully_qualified_name TEXT,
  account_number    TEXT,
  account_type      TEXT,            -- QBO AccountType, e.g. "Expense"
  account_sub_type  TEXT,            -- QBO AccountSubType, e.g. "Advertising"
  classification    TEXT,            -- Revenue / Expense / Asset / Liability / Equity
  parent_qbo_id     TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  current_balance   NUMERIC(18,2),
  currency_code     TEXT,
  source_updated_at TIMESTAMPTZ,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, qbo_id)
);
CREATE INDEX IF NOT EXISTS accounts_company_idx ON accounts(company_id);

CREATE TABLE IF NOT EXISTS customers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  qbo_id       TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email        TEXT,
  phone        TEXT,
  balance      NUMERIC(18,2),
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, qbo_id)
);

CREATE TABLE IF NOT EXISTS vendors (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  qbo_id       TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email        TEXT,
  phone        TEXT,
  balance      NUMERIC(18,2),
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  first_seen_on DATE,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, qbo_id)
);
CREATE INDEX IF NOT EXISTS vendors_company_idx ON vendors(company_id);

CREATE TABLE IF NOT EXISTS items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  qbo_id       TEXT NOT NULL,
  name         TEXT NOT NULL,
  sku          TEXT,
  item_type    TEXT,
  income_account_qbo_id  TEXT,
  expense_account_qbo_id TEXT,
  asset_account_qbo_id   TEXT,
  qty_on_hand  NUMERIC(18,4),
  unit_price   NUMERIC(18,2),
  purchase_cost NUMERIC(18,2),
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, qbo_id)
);

CREATE TABLE IF NOT EXISTS classes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  qbo_id     TEXT NOT NULL,
  name       TEXT NOT NULL,
  fully_qualified_name TEXT,
  parent_qbo_id TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  synced_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, qbo_id)
);

CREATE TABLE IF NOT EXISTS locations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  qbo_id     TEXT NOT NULL,
  name       TEXT NOT NULL,
  fully_qualified_name TEXT,
  parent_qbo_id TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  -- owner-facing configuration
  display_name TEXT,
  is_store     BOOLEAN NOT NULL DEFAULT TRUE,
  opened_on    DATE,
  synced_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, qbo_id)
);

-- --------------------------------------------------------------------------
-- Transactions (used for vendor spend, large-transaction review, drill-down)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  qbo_id        TEXT NOT NULL,
  txn_type      TEXT NOT NULL,      -- Invoice, Bill, Purchase, JournalEntry, ...
  txn_date      DATE NOT NULL,
  doc_number    TEXT,
  entity_type   TEXT,               -- Vendor / Customer / Employee
  entity_qbo_id TEXT,
  entity_name   TEXT,
  memo          TEXT,
  total_amount  NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency_code TEXT,
  location_qbo_id TEXT,
  class_qbo_id  TEXT,
  posted        BOOLEAN NOT NULL DEFAULT TRUE,
  source_updated_at TIMESTAMPTZ,
  source_fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, txn_type, qbo_id)
);
CREATE INDEX IF NOT EXISTS transactions_company_date_idx ON transactions(company_id, txn_date);
CREATE INDEX IF NOT EXISTS transactions_entity_idx ON transactions(company_id, entity_qbo_id);
CREATE INDEX IF NOT EXISTS transactions_amount_idx ON transactions(company_id, total_amount);

CREATE TABLE IF NOT EXISTS transaction_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  line_num        INTEGER,
  description     TEXT,
  amount          NUMERIC(18,2) NOT NULL DEFAULT 0,
  account_qbo_id  TEXT,
  account_name    TEXT,
  item_qbo_id     TEXT,
  class_qbo_id    TEXT,
  location_qbo_id TEXT,
  customer_qbo_id TEXT,
  quantity        NUMERIC(18,4),
  detail_type     TEXT
);
CREATE INDEX IF NOT EXISTS txn_lines_txn_idx ON transaction_lines(transaction_id);
CREATE INDEX IF NOT EXISTS txn_lines_account_idx ON transaction_lines(company_id, account_qbo_id);

-- --------------------------------------------------------------------------
-- Raw report snapshots (immutable copies of what QuickBooks returned)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_snapshots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  report_type    TEXT NOT NULL,     -- ProfitAndLoss, BalanceSheet, AgedReceivables...
  period_start   DATE NOT NULL,
  period_end     DATE NOT NULL,
  dimension      TEXT NOT NULL DEFAULT 'total'   -- total | location | class
    CHECK (dimension IN ('total','location','class','customer','vendor','item')),
  accounting_method TEXT NOT NULL DEFAULT 'Accrual',
  payload        JSONB NOT NULL,
  source_system  TEXT NOT NULL DEFAULT 'quickbooks_online',
  source_realm_id TEXT,
  source_fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_job_id    UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, report_type, period_start, period_end, dimension, accounting_method)
);
CREATE INDEX IF NOT EXISTS report_snapshots_lookup_idx
  ON report_snapshots(company_id, report_type, period_end DESC);

-- --------------------------------------------------------------------------
-- Account mapping engine
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS management_categories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,          -- stable machine key, e.g. 'advertising'
  label        TEXT NOT NULL,          -- 'Advertising'
  section      TEXT NOT NULL           -- where it lands in the P&L
                 CHECK (section IN ('revenue','contra_revenue','cogs','opex','other_income','other_expense','balance_sheet','ignore')),
  sort_order   INTEGER NOT NULL DEFAULT 100,
  is_custom    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, key)
);

CREATE TABLE IF NOT EXISTS account_mappings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_qbo_id TEXT NOT NULL,
  category_key   TEXT NOT NULL,
  confidence     NUMERIC(5,4) NOT NULL DEFAULT 1.0,
  source         TEXT NOT NULL DEFAULT 'manual'
                   CHECK (source IN ('manual','suggested','default')),
  approved       BOOLEAN NOT NULL DEFAULT FALSE,
  suggested_reason TEXT,
  approved_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, account_qbo_id)
);
CREATE INDEX IF NOT EXISTS account_mappings_company_idx ON account_mappings(company_id);

-- --------------------------------------------------------------------------
-- Monthly snapshots / metrics (the analytical core)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_metrics (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_start       DATE NOT NULL,
  period_end         DATE NOT NULL,
  -- income statement
  gross_sales        NUMERIC(18,2) NOT NULL DEFAULT 0,
  discounts          NUMERIC(18,2) NOT NULL DEFAULT 0,
  refunds            NUMERIC(18,2) NOT NULL DEFAULT 0,
  net_sales          NUMERIC(18,2) NOT NULL DEFAULT 0,
  cogs               NUMERIC(18,2) NOT NULL DEFAULT 0,
  gross_profit       NUMERIC(18,2) NOT NULL DEFAULT 0,
  gross_margin       NUMERIC(12,6),
  operating_expenses NUMERIC(18,2) NOT NULL DEFAULT 0,
  payroll_expense    NUMERIC(18,2) NOT NULL DEFAULT 0,
  advertising_expense NUMERIC(18,2) NOT NULL DEFAULT 0,
  rent_expense       NUMERIC(18,2) NOT NULL DEFAULT 0,
  delivery_expense   NUMERIC(18,2) NOT NULL DEFAULT 0,
  freight_expense    NUMERIC(18,2) NOT NULL DEFAULT 0,
  warehouse_expense  NUMERIC(18,2) NOT NULL DEFAULT 0,
  financing_fees     NUMERIC(18,2) NOT NULL DEFAULT 0,
  merchant_fees      NUMERIC(18,2) NOT NULL DEFAULT 0,
  bank_fees          NUMERIC(18,2) NOT NULL DEFAULT 0,
  interest_expense   NUMERIC(18,2) NOT NULL DEFAULT 0,
  utilities_expense  NUMERIC(18,2) NOT NULL DEFAULT 0,
  insurance_expense  NUMERIC(18,2) NOT NULL DEFAULT 0,
  repairs_expense    NUMERIC(18,2) NOT NULL DEFAULT 0,
  vehicle_expense    NUMERIC(18,2) NOT NULL DEFAULT 0,
  professional_fees  NUMERIC(18,2) NOT NULL DEFAULT 0,
  software_expense   NUMERIC(18,2) NOT NULL DEFAULT 0,
  taxes_expense      NUMERIC(18,2) NOT NULL DEFAULT 0,
  other_opex         NUMERIC(18,2) NOT NULL DEFAULT 0,
  net_operating_income NUMERIC(18,2) NOT NULL DEFAULT 0,
  other_income       NUMERIC(18,2) NOT NULL DEFAULT 0,
  other_expense      NUMERIC(18,2) NOT NULL DEFAULT 0,
  net_income         NUMERIC(18,2) NOT NULL DEFAULT 0,
  net_margin         NUMERIC(12,6),
  -- balance sheet
  cash                 NUMERIC(18,2),
  accounts_receivable  NUMERIC(18,2),
  accounts_payable     NUMERIC(18,2),
  inventory_value      NUMERIC(18,2),
  other_current_assets NUMERIC(18,2),
  current_assets       NUMERIC(18,2),
  fixed_assets         NUMERIC(18,2),
  total_assets         NUMERIC(18,2),
  credit_cards         NUMERIC(18,2),
  short_term_debt      NUMERIC(18,2),
  long_term_debt       NUMERIC(18,2),
  current_liabilities  NUMERIC(18,2),
  total_liabilities    NUMERIC(18,2),
  equity               NUMERIC(18,2),
  -- data quality / provenance
  unmapped_opex_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  unmapped_opex_pct    NUMERIC(12,6) NOT NULL DEFAULT 0,
  balance_sheet_balanced BOOLEAN,
  source_system      TEXT NOT NULL DEFAULT 'quickbooks_online',
  source_snapshot_ids UUID[] NOT NULL DEFAULT '{}',
  computed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_start, period_end)
);
CREATE INDEX IF NOT EXISTS monthly_metrics_period_idx ON monthly_metrics(company_id, period_start DESC);

-- Per-account monthly detail, used for expense analysis + drill-down
CREATE TABLE IF NOT EXISTS monthly_account_metrics (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_start   DATE NOT NULL,
  period_end     DATE NOT NULL,
  account_qbo_id TEXT NOT NULL,
  account_name   TEXT NOT NULL,
  classification TEXT,
  category_key   TEXT,
  amount         NUMERIC(18,2) NOT NULL DEFAULT 0,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_start, account_qbo_id)
);
CREATE INDEX IF NOT EXISTS monthly_account_metrics_idx
  ON monthly_account_metrics(company_id, period_start, category_key);

CREATE TABLE IF NOT EXISTS monthly_location_metrics (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL,
  dimension        TEXT NOT NULL DEFAULT 'location'
                     CHECK (dimension IN ('location','class')),
  dimension_qbo_id TEXT,
  dimension_name   TEXT NOT NULL,
  net_sales        NUMERIC(18,2) NOT NULL DEFAULT 0,
  cogs             NUMERIC(18,2) NOT NULL DEFAULT 0,
  gross_profit     NUMERIC(18,2) NOT NULL DEFAULT 0,
  gross_margin     NUMERIC(12,6),
  payroll_expense  NUMERIC(18,2) NOT NULL DEFAULT 0,
  advertising_expense NUMERIC(18,2) NOT NULL DEFAULT 0,
  rent_expense     NUMERIC(18,2) NOT NULL DEFAULT 0,
  operating_expenses NUMERIC(18,2) NOT NULL DEFAULT 0,
  contribution_profit NUMERIC(18,2) NOT NULL DEFAULT 0,
  contribution_margin NUMERIC(12,6),
  -- true when unallocated/corporate overhead has NOT been pushed down
  overhead_allocated BOOLEAN NOT NULL DEFAULT FALSE,
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_start, dimension, dimension_name)
);
CREATE INDEX IF NOT EXISTS monthly_location_metrics_idx
  ON monthly_location_metrics(company_id, period_start);

CREATE TABLE IF NOT EXISTS monthly_vendor_spend (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  vendor_qbo_id TEXT,
  vendor_name   TEXT NOT NULL,
  amount        NUMERIC(18,2) NOT NULL DEFAULT 0,
  txn_count     INTEGER NOT NULL DEFAULT 0,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_start, vendor_name)
);
CREATE INDEX IF NOT EXISTS monthly_vendor_spend_idx ON monthly_vendor_spend(company_id, period_start);

CREATE TABLE IF NOT EXISTS aging_snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  as_of_date   DATE NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('receivable','payable')),
  entity_name  TEXT NOT NULL,             -- '__TOTAL__' for the roll-up row
  entity_qbo_id TEXT,
  current_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  days_1_30    NUMERIC(18,2) NOT NULL DEFAULT 0,
  days_31_60   NUMERIC(18,2) NOT NULL DEFAULT 0,
  days_61_90   NUMERIC(18,2) NOT NULL DEFAULT 0,
  days_90_plus NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, as_of_date, kind, entity_name)
);
CREATE INDEX IF NOT EXISTS aging_snapshots_idx ON aging_snapshots(company_id, kind, as_of_date DESC);

-- --------------------------------------------------------------------------
-- Anomalies, insights, reports
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anomaly_thresholds (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rule_key     TEXT NOT NULL,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  params       JSONB NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, rule_key)
);

CREATE TABLE IF NOT EXISTS anomalies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  rule_key      TEXT NOT NULL,
  severity      TEXT NOT NULL CHECK (severity IN ('INFO','WATCH','IMPORTANT','CRITICAL')),
  category      TEXT NOT NULL,
  title         TEXT NOT NULL,
  detail        TEXT NOT NULL,
  metric_key    TEXT,
  current_value NUMERIC(18,2),
  comparison_value NUMERIC(18,2),
  delta_amount  NUMERIC(18,2),
  delta_pct     NUMERIC(12,6),
  score         NUMERIC(12,4) NOT NULL DEFAULT 0,
  evidence      JSONB NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','acknowledged','dismissed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_start, rule_key, title)
);
CREATE INDEX IF NOT EXISTS anomalies_period_idx ON anomalies(company_id, period_start DESC, score DESC);

CREATE TABLE IF NOT EXISTS generated_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  title         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','syncing','analyzing','generating','completed','failed')),
  confidence    TEXT CHECK (confidence IN ('high','medium','low')),
  confidence_reasons JSONB NOT NULL DEFAULT '[]',
  payload       JSONB,           -- the fully computed, deterministic report data
  executive_summary TEXT,
  error_message TEXT,
  generated_by  TEXT NOT NULL DEFAULT 'manual'
                  CHECK (generated_by IN ('manual','scheduled')),
  requested_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_start, period_end)
);
CREATE INDEX IF NOT EXISTS generated_reports_idx ON generated_reports(company_id, period_start DESC);

CREATE TABLE IF NOT EXISTS report_sections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   UUID NOT NULL REFERENCES generated_reports(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  title       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  narrative   TEXT,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (report_id, section_key)
);

CREATE TABLE IF NOT EXISTS ai_insights (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  report_id      UUID REFERENCES generated_reports(id) ON DELETE CASCADE,
  period_start   DATE NOT NULL,
  category       TEXT NOT NULL,
  severity       TEXT NOT NULL CHECK (severity IN ('INFO','WATCH','IMPORTANT','CRITICAL')),
  observation    TEXT NOT NULL,
  supporting_metrics JSONB NOT NULL DEFAULT '[]',
  likely_implication TEXT,
  recommended_action TEXT,
  confidence     TEXT NOT NULL CHECK (confidence IN ('low','medium','high')),
  model          TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_insights_report_idx ON ai_insights(report_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  conversation_id UUID NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content      TEXT NOT NULL,
  intent       TEXT,
  resolved_data JSONB,
  data_through DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_conv_idx ON chat_messages(conversation_id, created_at);

-- --------------------------------------------------------------------------
-- Operations: sync jobs + audit trail
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_jobs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_type       TEXT NOT NULL,   -- historical_import | monthly_sync | master_data | report
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','running','completed','failed','partial')),
  period_start   DATE,
  period_end     DATE,
  months_requested INTEGER,
  progress_current INTEGER NOT NULL DEFAULT 0,
  progress_total   INTEGER NOT NULL DEFAULT 0,
  current_step   TEXT,
  steps          JSONB NOT NULL DEFAULT '[]',
  error_message  TEXT,
  retry_count    INTEGER NOT NULL DEFAULT 0,
  triggered_by   TEXT NOT NULL DEFAULT 'manual',
  requested_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sync_jobs_company_idx ON sync_jobs(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  company_id  UUID REFERENCES companies(id) ON DELETE SET NULL,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  outcome     TEXT NOT NULL DEFAULT 'success'
                CHECK (outcome IN ('success','failure')),
  ip_address  TEXT,
  user_agent  TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_company_idx ON audit_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action, created_at DESC);

-- --------------------------------------------------------------------------
-- Settings: branding + schedules
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_branding (
  company_id     UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  business_name  TEXT,
  logo_data_url  TEXT,
  report_title_template TEXT NOT NULL DEFAULT '{month} {year} Executive Financial Report',
  primary_color  TEXT NOT NULL DEFAULT '#1e3a5f',
  footer_text    TEXT,
  confidential   BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS report_schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  day_of_month  SMALLINT NOT NULL DEFAULT 3 CHECK (day_of_month BETWEEN 1 AND 28),
  timezone      TEXT NOT NULL DEFAULT 'America/New_York',
  retention_months INTEGER NOT NULL DEFAULT 36,
  last_run_at   TIMESTAMPTZ,
  last_run_status TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id)
);

CREATE TABLE IF NOT EXISTS auth_failures (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT,
  reason      TEXT NOT NULL,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_failures_idx ON auth_failures(email, created_at DESC);
