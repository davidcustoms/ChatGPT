import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { recordAudit } from '@/lib/db/repositories/audit';
import {
  consumeOAuthState,
  updateConnectionCompanyInfo,
  upsertConnectionWithTokens,
} from '@/lib/db/repositories/connections';
import { updateCompanySettings } from '@/lib/db/repositories/companies';
import { exchangeCodeForTokens } from '@/lib/qbo/oauth';
import { QuickBooksClient } from '@/lib/qbo/client';
import { fetchCompanyInfo } from '@/lib/qbo/entities';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

function redirectWith(path: string, params: Record<string, string>): NextResponse {
  const url = new URL(path, env().NEXT_PUBLIC_APP_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

/** Intuit redirects here with `code`, `state` and `realmId`. */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const realmId = url.searchParams.get('realmId');
  const oauthError = url.searchParams.get('error');

  if (oauthError) {
    await recordAudit({
      action: 'quickbooks.oauth_denied',
      outcome: 'failure',
      metadata: { error: oauthError },
    });
    return redirectWith('/settings/quickbooks', {
      error: `QuickBooks authorisation was declined (${oauthError}).`,
    });
  }

  if (!code || !state || !realmId) {
    return redirectWith('/settings/quickbooks', {
      error: 'The QuickBooks callback was missing required parameters.',
    });
  }

  const consumed = await consumeOAuthState(state);
  if (!consumed) {
    // Invalid, expired or replayed state: treat as a security event.
    await recordAudit({
      action: 'quickbooks.oauth_state_invalid',
      outcome: 'failure',
      metadata: { realmId },
    });
    logger.warn('rejected quickbooks callback with invalid state', { realmId });
    return redirectWith('/settings/quickbooks', {
      error:
        'The QuickBooks authorisation link has expired or was already used. Please start the connection again.',
    });
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const companyId = consumed.companyId;
    if (!companyId) {
      return redirectWith('/settings/quickbooks', {
        error: 'No company was associated with this connection attempt.',
      });
    }

    const connection = await upsertConnectionWithTokens({
      companyId,
      realmId,
      environment: env().INTUIT_ENVIRONMENT,
      tokens,
    });

    // Fetch company information immediately so the connection page is useful.
    try {
      const client = new QuickBooksClient({
        realmId,
        accessToken: tokens.accessToken,
        environment: env().INTUIT_ENVIRONMENT,
      });
      const info = await fetchCompanyInfo(client, realmId);
      await updateConnectionCompanyInfo(connection.id, info);
      if (info.companyName) {
        await updateCompanySettings(companyId, {
          name: info.companyName,
          fiscalYearStartMonth: info.fiscalYearStartMonth ?? undefined,
        });
      }
    } catch (err) {
      logger.warn('company info fetch failed after connect', {
        message: err instanceof Error ? err.message : String(err),
      });
    }

    await recordAudit({
      companyId,
      userId: consumed.userId,
      action: 'quickbooks.connected',
      entityType: 'connection',
      entityId: connection.id,
      metadata: { realmId, environment: env().INTUIT_ENVIRONMENT },
    });

    return redirectWith(consumed.redirectTo ?? '/settings/quickbooks', {
      connected: '1',
      company: companyId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token exchange failed';
    await recordAudit({
      companyId: consumed.companyId,
      userId: consumed.userId,
      action: 'quickbooks.connect_failed',
      outcome: 'failure',
      metadata: { message },
    });
    return redirectWith('/settings/quickbooks', { error: message });
  }
}
