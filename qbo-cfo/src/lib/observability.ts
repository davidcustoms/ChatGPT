import { logger } from './logger';

/**
 * Named operational events.
 *
 * Using a fixed vocabulary rather than ad-hoc log strings means an operator can
 * alert on `qbo.token_refresh_failed` without pattern-matching prose, and it
 * keeps every emission on the redacting logger rather than a bare console call.
 */
export type OpsEvent =
  | 'oauth.started'
  | 'oauth.completed'
  | 'oauth.failed'
  | 'oauth.state_rejected'
  | 'oauth.disconnected'
  | 'qbo.token_refreshed'
  | 'qbo.token_refresh_failed'
  | 'qbo.api_failed'
  | 'qbo.rate_limited'
  | 'sync.started'
  | 'sync.finished'
  | 'sync.failed'
  | 'sync.lock_contended'
  | 'report.started'
  | 'report.finished'
  | 'report.failed'
  | 'report.exported'
  | 'anomaly.generated'
  | 'ai.request'
  | 'ai.failed'
  | 'ai.output_rejected'
  | 'ai.injection_signal'
  | 'scheduler.started'
  | 'scheduler.finished'
  | 'scheduler.skipped';

export interface OpsFields {
  companyId?: string;
  period?: string;
  jobId?: string;
  reportId?: string;
  durationMs?: number;
  count?: number;
  status?: string;
  reason?: string;
  [key: string]: unknown;
}

/** Emits a structured operational event. Secrets are redacted by the logger. */
export function event(name: OpsEvent, fields: OpsFields = {}): void {
  const level = name.endsWith('failed') || name.endsWith('rejected') || name.endsWith('contended')
    ? 'warn'
    : 'info';
  const payload = { event: name, ...fields };
  if (level === 'warn') logger.warn(name, payload);
  else logger.info(name, payload);
}

/** Times an operation and emits start/finish (or failure) events around it. */
export async function tracked<T>(
  name: { start: OpsEvent; finish: OpsEvent; fail: OpsEvent },
  fields: OpsFields,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  event(name.start, fields);
  try {
    const result = await fn();
    event(name.finish, { ...fields, durationMs: Date.now() - startedAt });
    return result;
  } catch (err) {
    event(name.fail, {
      ...fields,
      durationMs: Date.now() - startedAt,
      reason: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
