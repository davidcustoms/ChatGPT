import { query } from '../pool';

export interface AuditEntry {
  companyId?: string | null;
  userId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  outcome?: 'success' | 'failure';
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

/** Append-only audit trail. Never throws into the caller's happy path. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs
         (company_id, user_id, action, entity_type, entity_id, outcome, ip_address, user_agent, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        entry.companyId ?? null,
        entry.userId ?? null,
        entry.action,
        entry.entityType ?? null,
        entry.entityId ?? null,
        entry.outcome ?? 'success',
        entry.ipAddress ?? null,
        entry.userAgent ?? null,
        JSON.stringify(entry.metadata ?? {}),
      ],
    );
  } catch {
    // An audit-write failure must not mask the original operation's result.
  }
}

export async function recordAuthFailure(input: {
  email?: string | null;
  reason: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO auth_failures (email, reason, ip_address, user_agent) VALUES ($1,$2,$3,$4)`,
      [input.email ?? null, input.reason, input.ipAddress ?? null, input.userAgent ?? null],
    );
  } catch {
    /* ignore */
  }
}

export interface AuditRow {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  outcome: string;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export async function listAudit(companyId: string, limit = 100): Promise<AuditRow[]> {
  return query<AuditRow>(
    `SELECT id::text, action, entity_type, entity_id, outcome, metadata, created_at
       FROM audit_logs WHERE company_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [companyId, limit],
  );
}

/** Recent failed sign-in attempts for a given email (simple rate limiting). */
export async function recentAuthFailureCount(email: string, withinMinutes = 15): Promise<number> {
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM auth_failures
      WHERE email = $1 AND created_at > now() - ($2 || ' minutes')::interval`,
    [email.toLowerCase().trim(), String(withinMinutes)],
  );
  return Number(rows[0]?.count ?? 0);
}
