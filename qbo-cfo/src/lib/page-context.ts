import { requireUserPage } from './auth/guards';
import { listCompaniesForUser, type Company } from './db/repositories/companies';
import { getConnectionForCompany, type Connection } from './db/repositories/connections';
import { listAllMetrics } from './db/repositories/metrics';
import type { PublicUser } from './db/repositories/users';
import { lastClosedMonth, monthLabel, monthPeriodOf, type Period } from './util/dates';

export type SearchParams = Record<string, string | string[] | undefined>;

export function param(searchParams: SearchParams, key: string): string | undefined {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

export interface PageContext {
  user: PublicUser;
  companies: Company[];
  company: Company | null;
  connection: Connection | null;
  /** Months with stored metrics, newest first. */
  availablePeriods: Array<{ value: string; label: string }>;
  period: Period;
  hasData: boolean;
  sourceLabel: string;
  dataThrough: string | null;
}

/**
 * Resolves the shared context every application page needs: the signed-in
 * user, the company they are viewing (validated against their access list) and
 * the reporting month.
 */
export async function getPageContext(searchParams: SearchParams): Promise<PageContext> {
  const user = await requireUserPage();
  const companies = await listCompaniesForUser(user.id);
  const requestedCompany = param(searchParams, 'company');
  const company =
    (requestedCompany ? companies.find((c) => c.id === requestedCompany) : undefined) ??
    companies[0] ??
    null;

  if (!company) {
    return {
      user,
      companies,
      company: null,
      connection: null,
      availablePeriods: [],
      period: lastClosedMonth(),
      hasData: false,
      sourceLabel: 'QuickBooks Online',
      dataThrough: null,
    };
  }

  const [connection, metrics] = await Promise.all([
    getConnectionForCompany(company.id),
    listAllMetrics(company.id, 48),
  ]);

  const availablePeriods = metrics
    .slice()
    .reverse()
    .map((m) => ({ value: m.period.start.slice(0, 7), label: monthLabel(m.period) }));

  const requestedPeriod = param(searchParams, 'period');
  const latest = metrics[metrics.length - 1]?.period ?? lastClosedMonth();
  const period =
    requestedPeriod && /^\d{4}-\d{2}$/.test(requestedPeriod)
      ? monthPeriodOf(`${requestedPeriod}-01`)
      : latest;

  return {
    user,
    companies,
    company,
    connection,
    availablePeriods,
    period,
    hasData: metrics.length > 0,
    sourceLabel: company.isDemo ? 'Demo data (synthetic)' : 'QuickBooks Online',
    dataThrough: metrics[metrics.length - 1]?.period.end ?? null,
  };
}
