import { dateOnly, num, query, queryOne } from '../pool';

export interface CompanyRow {
  id: string;
  owner_user_id: string;
  name: string;
  legal_name: string | null;
  country: string | null;
  fiscal_year_start_month: number;
  currency_code: string;
  is_demo: boolean;
  tracking_dimension: 'auto' | 'location' | 'class' | 'none';
  materiality_amount: string;
  materiality_pct: string;
  created_at: Date;
}

export interface Company {
  id: string;
  ownerUserId: string;
  name: string;
  legalName: string | null;
  country: string | null;
  fiscalYearStartMonth: number;
  currencyCode: string;
  isDemo: boolean;
  trackingDimension: 'auto' | 'location' | 'class' | 'none';
  materialityAmount: number;
  materialityPct: number;
}

export function toCompany(row: CompanyRow): Company {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    legalName: row.legal_name,
    country: row.country,
    fiscalYearStartMonth: row.fiscal_year_start_month,
    currencyCode: row.currency_code,
    isDemo: row.is_demo,
    trackingDimension: row.tracking_dimension,
    materialityAmount: num(row.materiality_amount),
    materialityPct: num(row.materiality_pct),
  };
}

export async function listCompaniesForUser(userId: string): Promise<Company[]> {
  const rows = await query<CompanyRow>(
    `SELECT c.* FROM companies c
      WHERE c.owner_user_id = $1
         OR EXISTS (SELECT 1 FROM company_members m WHERE m.company_id = c.id AND m.user_id = $1)
      ORDER BY c.is_demo ASC, c.created_at ASC`,
    [userId],
  );
  return rows.map(toCompany);
}

export async function getCompany(companyId: string): Promise<Company | null> {
  const row = await queryOne<CompanyRow>('SELECT * FROM companies WHERE id = $1', [companyId]);
  return row ? toCompany(row) : null;
}

/** Authorisation check: does this user have access to this company? */
export async function userCanAccessCompany(userId: string, companyId: string): Promise<boolean> {
  const row = await queryOne<{ ok: boolean }>(
    `SELECT TRUE AS ok FROM companies c
      WHERE c.id = $2
        AND (c.owner_user_id = $1
             OR EXISTS (SELECT 1 FROM company_members m WHERE m.company_id = c.id AND m.user_id = $1))`,
    [userId, companyId],
  );
  return Boolean(row?.ok);
}

export async function createCompany(input: {
  ownerUserId: string;
  name: string;
  legalName?: string | null;
  country?: string | null;
  fiscalYearStartMonth?: number;
  currencyCode?: string;
  isDemo?: boolean;
}): Promise<Company> {
  const rows = await query<CompanyRow>(
    `INSERT INTO companies (owner_user_id, name, legal_name, country, fiscal_year_start_month, currency_code, is_demo)
     VALUES ($1,$2,$3,$4,COALESCE($5,1),COALESCE($6,'USD'),COALESCE($7,FALSE))
     RETURNING *`,
    [
      input.ownerUserId,
      input.name,
      input.legalName ?? null,
      input.country ?? null,
      input.fiscalYearStartMonth ?? null,
      input.currencyCode ?? null,
      input.isDemo ?? null,
    ],
  );
  return toCompany(rows[0] as CompanyRow);
}

export async function updateCompanySettings(
  companyId: string,
  patch: Partial<{
    name: string;
    fiscalYearStartMonth: number;
    currencyCode: string;
    trackingDimension: 'auto' | 'location' | 'class' | 'none';
    materialityAmount: number;
    materialityPct: number;
  }>,
): Promise<void> {
  await query(
    `UPDATE companies SET
       name = COALESCE($2, name),
       fiscal_year_start_month = COALESCE($3, fiscal_year_start_month),
       currency_code = COALESCE($4, currency_code),
       tracking_dimension = COALESCE($5, tracking_dimension),
       materiality_amount = COALESCE($6, materiality_amount),
       materiality_pct = COALESCE($7, materiality_pct),
       updated_at = now()
     WHERE id = $1`,
    [
      companyId,
      patch.name ?? null,
      patch.fiscalYearStartMonth ?? null,
      patch.currencyCode ?? null,
      patch.trackingDimension ?? null,
      patch.materialityAmount ?? null,
      patch.materialityPct ?? null,
    ],
  );
}

export interface BrandingRow {
  company_id: string;
  business_name: string | null;
  logo_data_url: string | null;
  report_title_template: string;
  primary_color: string;
  footer_text: string | null;
  confidential: boolean;
}

export interface Branding {
  businessName: string | null;
  logoDataUrl: string | null;
  reportTitleTemplate: string;
  primaryColor: string;
  footerText: string | null;
  confidential: boolean;
}

export const DEFAULT_BRANDING: Branding = {
  businessName: null,
  logoDataUrl: null,
  reportTitleTemplate: '{month} {year} Executive Financial Report',
  primaryColor: '#1e3a5f',
  footerText: null,
  confidential: true,
};

export async function getBranding(companyId: string): Promise<Branding> {
  const row = await queryOne<BrandingRow>('SELECT * FROM report_branding WHERE company_id = $1', [
    companyId,
  ]);
  if (!row) return DEFAULT_BRANDING;
  return {
    businessName: row.business_name,
    logoDataUrl: row.logo_data_url,
    reportTitleTemplate: row.report_title_template,
    primaryColor: row.primary_color,
    footerText: row.footer_text,
    confidential: row.confidential,
  };
}

export async function saveBranding(companyId: string, branding: Partial<Branding>): Promise<void> {
  await query(
    `INSERT INTO report_branding
       (company_id, business_name, logo_data_url, report_title_template, primary_color, footer_text, confidential, updated_at)
     VALUES ($1,$2,$3,COALESCE($4,'{month} {year} Executive Financial Report'),COALESCE($5,'#1e3a5f'),$6,COALESCE($7,TRUE), now())
     ON CONFLICT (company_id) DO UPDATE SET
       business_name = EXCLUDED.business_name,
       logo_data_url = EXCLUDED.logo_data_url,
       report_title_template = EXCLUDED.report_title_template,
       primary_color = EXCLUDED.primary_color,
       footer_text = EXCLUDED.footer_text,
       confidential = EXCLUDED.confidential,
       updated_at = now()`,
    [
      companyId,
      branding.businessName ?? null,
      branding.logoDataUrl ?? null,
      branding.reportTitleTemplate ?? null,
      branding.primaryColor ?? null,
      branding.footerText ?? null,
      branding.confidential ?? null,
    ],
  );
}

export interface Schedule {
  enabled: boolean;
  dayOfMonth: number;
  timezone: string;
  retentionMonths: number;
  lastRunAt: string | null;
  lastRunStatus: string | null;
}

export async function getSchedule(companyId: string): Promise<Schedule> {
  const row = await queryOne<{
    enabled: boolean;
    day_of_month: number;
    timezone: string;
    retention_months: number;
    last_run_at: Date | null;
    last_run_status: string | null;
  }>('SELECT * FROM report_schedules WHERE company_id = $1', [companyId]);
  return {
    enabled: row?.enabled ?? true,
    dayOfMonth: row?.day_of_month ?? 3,
    timezone: row?.timezone ?? 'America/New_York',
    retentionMonths: row?.retention_months ?? 36,
    lastRunAt: row?.last_run_at ? row.last_run_at.toISOString() : null,
    lastRunStatus: row?.last_run_status ?? null,
  };
}

export async function saveSchedule(companyId: string, patch: Partial<Schedule>): Promise<void> {
  await query(
    `INSERT INTO report_schedules (company_id, enabled, day_of_month, timezone, retention_months, updated_at)
     VALUES ($1, COALESCE($2,TRUE), COALESCE($3,3), COALESCE($4,'America/New_York'), COALESCE($5,36), now())
     ON CONFLICT (company_id) DO UPDATE SET
       enabled = COALESCE($2, report_schedules.enabled),
       day_of_month = COALESCE($3, report_schedules.day_of_month),
       timezone = COALESCE($4, report_schedules.timezone),
       retention_months = COALESCE($5, report_schedules.retention_months),
       updated_at = now()`,
    [
      companyId,
      patch.enabled ?? null,
      patch.dayOfMonth ?? null,
      patch.timezone ?? null,
      patch.retentionMonths ?? null,
    ],
  );
}

export async function markScheduleRun(companyId: string, status: string): Promise<void> {
  await query(
    `UPDATE report_schedules SET last_run_at = now(), last_run_status = $2 WHERE company_id = $1`,
    [companyId, status],
  );
}

export async function listSchedulableCompanies(): Promise<
  Array<{ companyId: string; dayOfMonth: number; enabled: boolean; lastRunAt: string | null }>
> {
  const rows = await query<{
    company_id: string;
    day_of_month: number;
    enabled: boolean;
    last_run_at: Date | null;
  }>(
    `SELECT c.id AS company_id,
            COALESCE(s.day_of_month, 3) AS day_of_month,
            COALESCE(s.enabled, TRUE) AS enabled,
            s.last_run_at
       FROM companies c
       LEFT JOIN report_schedules s ON s.company_id = c.id`,
  );
  return rows.map((r) => ({
    companyId: r.company_id,
    dayOfMonth: r.day_of_month,
    enabled: r.enabled,
    lastRunAt: r.last_run_at ? r.last_run_at.toISOString() : null,
  }));
}

export { dateOnly };
