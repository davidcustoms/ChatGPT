import { z } from 'zod';
import { companyIdSchema, handler, parseBody } from '@/lib/api';
import { requireCompany } from '@/lib/auth/guards';
import { recordAudit } from '@/lib/db/repositories/audit';
import { disconnect, getConnectionForCompany, getTokens } from '@/lib/db/repositories/connections';
import { AppError } from '@/lib/errors';
import { revokeToken } from '@/lib/qbo/oauth';

export const dynamic = 'force-dynamic';

const schema = z.object({ companyId: companyIdSchema });

/** Disconnects QuickBooks: revokes the refresh token, then deletes it locally. */
export async function POST(request: Request) {
  return handler(async () => {
    const body = await parseBody(request, schema);
    const { user, company } = await requireCompany(body.companyId);
    const connection = await getConnectionForCompany(company.id);
    if (!connection) throw new AppError('NOT_FOUND', 'No active QuickBooks connection to disconnect.');

    const tokens = await getTokens(connection.id);
    const revoked = tokens ? await revokeToken(tokens.refreshToken) : false;
    await disconnect(connection.id);

    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: 'quickbooks.disconnected',
      entityType: 'connection',
      entityId: connection.id,
      metadata: { revoked },
    });

    return { ok: true, revoked };
  });
}
