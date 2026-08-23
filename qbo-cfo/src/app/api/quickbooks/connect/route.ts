import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { createCompany, listCompaniesForUser } from '@/lib/db/repositories/companies';
import { createOAuthState } from '@/lib/db/repositories/connections';
import { recordAudit } from '@/lib/db/repositories/audit';
import { buildAuthorizeUrl } from '@/lib/qbo/oauth';
import { toErrorPayload } from '@/lib/errors';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Starts the Intuit OAuth flow.
 *
 * A single-use `state` value is persisted server-side and validated on the
 * callback, so the redirect cannot be forged or replayed.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const requestedCompany = url.searchParams.get('company');

    let companyId = requestedCompany;
    if (!companyId) {
      const companies = await listCompaniesForUser(user.id);
      const real = companies.find((c) => !c.isDemo);
      companyId = real?.id ?? (await createCompany({ ownerUserId: user.id, name: 'My Company' })).id;
    }

    const state = await createOAuthState({
      userId: user.id,
      companyId,
      redirectTo: url.searchParams.get('redirect') ?? '/settings/quickbooks',
    });

    await recordAudit({
      companyId,
      userId: user.id,
      action: 'quickbooks.oauth_started',
      entityType: 'company',
      entityId: companyId,
    });

    return NextResponse.redirect(buildAuthorizeUrl(state));
  } catch (err) {
    const { error } = toErrorPayload(err);
    const target = new URL('/settings/quickbooks', env().NEXT_PUBLIC_APP_URL);
    target.searchParams.set('error', error.message);
    return NextResponse.redirect(target);
  }
}
