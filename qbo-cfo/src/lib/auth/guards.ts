import { redirect } from 'next/navigation';
import { AppError } from '../errors';
import { getCurrentUser, requireUser } from './session';
import { getCompany, listCompaniesForUser, userCanAccessCompany, type Company } from '../db/repositories/companies';
import type { PublicUser } from '../db/repositories/users';

/** Server-component guard: redirects anonymous visitors to /login. */
export async function requireUserPage(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

/**
 * Resolves the active company for a request.
 *
 * `companyId` (from a query string or JSON body) is validated against the
 * caller's access list -- an attacker cannot read another tenant's books by
 * changing the id.
 */
export async function resolveCompany(
  user: PublicUser,
  companyId?: string | null,
): Promise<Company | null> {
  if (companyId) {
    const allowed = await userCanAccessCompany(user.id, companyId);
    if (!allowed) throw new AppError('FORBIDDEN', 'You do not have access to this company.');
    return getCompany(companyId);
  }
  const companies = await listCompaniesForUser(user.id);
  return companies[0] ?? null;
}

export async function requireCompany(companyId?: string | null): Promise<{ user: PublicUser; company: Company }> {
  const user = await requireUser();
  const company = await resolveCompany(user, companyId);
  if (!company) {
    throw new AppError('NOT_FOUND', 'No company found. Connect QuickBooks or enable demo mode first.');
  }
  return { user, company };
}

export async function requireCompanyPage(
  companyId?: string | null,
): Promise<{ user: PublicUser; company: Company | null; companies: Company[] }> {
  const user = await requireUserPage();
  const companies = await listCompaniesForUser(user.id);
  const company = companyId
    ? (companies.find((c) => c.id === companyId) ?? null)
    : (companies[0] ?? null);
  return { user, company, companies };
}
