import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(path.join(process.cwd(), 'db', 'schema.sql'), 'utf8');

/**
 * Structural guarantees the application relies on. These are asserted against
 * the schema itself so a future migration cannot quietly drop the constraint
 * that prevents a month from being imported twice.
 */
describe('duplicate snapshot prevention', () => {
  it('makes a raw report snapshot unique per company, type, period and dimension', () => {
    expect(schema).toMatch(
      /UNIQUE \(company_id, report_type, period_start, period_end, dimension, accounting_method\)/,
    );
  });

  it('makes computed monthly metrics unique per company and period', () => {
    expect(schema).toMatch(/UNIQUE \(company_id, period_start, period_end\)/);
  });

  it('makes per-account, per-location and per-vendor monthly rows unique', () => {
    expect(schema).toMatch(/UNIQUE \(company_id, period_start, account_qbo_id\)/);
    expect(schema).toMatch(/UNIQUE \(company_id, period_start, dimension, dimension_name\)/);
    expect(schema).toMatch(/UNIQUE \(company_id, period_start, vendor_name\)/);
  });

  it('makes an aging snapshot unique per company, date, kind and entity', () => {
    expect(schema).toMatch(/UNIQUE \(company_id, as_of_date, kind, entity_name\)/);
  });

  it('allows at most one report per company per period', () => {
    const reports = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS generated_reports'));
    expect(reports.slice(0, reports.indexOf(');'))).toMatch(
      /UNIQUE \(company_id, period_start, period_end\)/,
    );
  });

  it('allows at most one mapping per account', () => {
    expect(schema).toMatch(/UNIQUE \(company_id, account_qbo_id\)/);
  });

  it('keys transactions on the QuickBooks id so a re-sync updates rather than duplicates', () => {
    expect(schema).toMatch(/UNIQUE \(company_id, txn_type, qbo_id\)/);
  });
});

describe('token storage', () => {
  it('stores only encrypted token columns', () => {
    const tokens = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS oauth_tokens'));
    const body = tokens.slice(0, tokens.indexOf(');'));
    expect(body).toContain('access_token_encrypted');
    expect(body).toContain('refresh_token_encrypted');
    // No plaintext token column may exist.
    expect(body).not.toMatch(/\n\s+access_token\s+TEXT/);
    expect(body).not.toMatch(/\n\s+refresh_token\s+TEXT/);
  });

  it('keeps one token record per connection', () => {
    expect(schema).toMatch(/connection_id\s+UUID\s+NOT NULL UNIQUE/);
  });

  it('makes OAuth state single-use and expiring', () => {
    const states = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS oauth_states'));
    const body = states.slice(0, states.indexOf(');'));
    expect(body).toContain('expires_at');
    expect(body).toContain('consumed_at');
  });
});

describe('money precision', () => {
  it('never stores money as a floating point type', () => {
    expect(schema).not.toMatch(/\b(REAL|DOUBLE PRECISION|FLOAT)\b/);
  });

  it('uses NUMERIC for amounts and ratios', () => {
    expect(schema).toMatch(/NUMERIC\(18,2\)/);
    expect(schema).toMatch(/NUMERIC\(12,6\)/);
  });
});

describe('traceability', () => {
  it('records where each snapshot came from', () => {
    const snapshots = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS report_snapshots'));
    const body = snapshots.slice(0, snapshots.indexOf(');'));
    expect(body).toContain('source_system');
    expect(body).toContain('source_realm_id');
    expect(body).toContain('source_fetched_at');
  });

  it('keeps an append-only audit log and a record of authentication failures', () => {
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS audit_logs');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS auth_failures');
  });
});
