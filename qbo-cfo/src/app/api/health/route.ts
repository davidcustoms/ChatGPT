import { NextResponse } from 'next/server';
import { env, isOpenAiConfigured, isQuickBooksConfigured } from '@/lib/env';
import { query } from '@/lib/db/pool';
import { APP_VERSION, AI_PROMPT_VERSION, CHAT_PROMPT_VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

/**
 * Liveness and readiness.
 *
 * Deliberately unauthenticated so a load balancer can reach it, and deliberately
 * free of secrets: it reports whether each dependency is *configured* and
 * *reachable*, never any credential, host or connection string. A failing
 * database returns 503 so an orchestrator can act on it.
 */
export async function GET(): Promise<NextResponse> {
  const startedAt = Date.now();

  const database = await checkDatabase();
  const scheduler = await checkScheduler(database.ok);

  const e = safeEnv();
  const quickbooks = {
    configured: e.quickbooksConfigured,
    environment: e.intuitEnvironment,
    // Presence only. The values themselves never appear in a response.
    clientIdPresent: e.clientIdPresent,
    redirectUriConfigured: e.redirectUriConfigured,
  };
  const ai = {
    configured: e.openAiConfigured,
    model: e.openAiConfigured ? e.openAiModel : null,
    promptVersions: { cfo: AI_PROMPT_VERSION, chat: CHAT_PROMPT_VERSION },
  };

  const ok = database.ok;
  const body = {
    status: ok ? 'ok' : 'degraded',
    app: {
      name: 'qbo-cfo',
      version: APP_VERSION,
      environment: e.nodeEnv,
      demoMode: e.demoMode,
      uptimeSeconds: Math.round(process.uptime()),
    },
    database,
    scheduler,
    quickbooks,
    ai,
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
  };

  return NextResponse.json(body, {
    status: ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}

async function checkDatabase(): Promise<{
  ok: boolean;
  latencyMs: number | null;
  migrationsApplied: boolean;
  error: string | null;
}> {
  const startedAt = Date.now();
  try {
    // Confirms both connectivity and that the schema has been applied.
    const rows = await query<{ present: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'monthly_metrics'
       ) AS present`,
    );
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      migrationsApplied: Boolean(rows[0]?.present),
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      migrationsApplied: false,
      // A generic reason: connection strings and hostnames stay out of responses.
      error: err instanceof Error && err.message.includes('database') ? 'database error' : 'unreachable',
    };
  }
}

async function checkScheduler(databaseOk: boolean): Promise<{
  configured: boolean;
  enabledCompanies: number | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  staleLocks: number | null;
}> {
  const configured = Boolean(env().CRON_SECRET);
  if (!databaseOk) {
    return { configured, enabledCompanies: null, lastRunAt: null, lastRunStatus: null, staleLocks: null };
  }
  try {
    const rows = await query<{
      enabled_companies: string;
      last_run_at: Date | null;
      last_run_status: string | null;
    }>(
      `SELECT COUNT(*) FILTER (WHERE enabled)::text AS enabled_companies,
              MAX(last_run_at) AS last_run_at,
              (ARRAY_AGG(last_run_status ORDER BY last_run_at DESC NULLS LAST))[1] AS last_run_status
         FROM report_schedules`,
    );
    const locks = await query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM sync_locks WHERE expires_at < now()',
    );
    return {
      configured,
      enabledCompanies: Number(rows[0]?.enabled_companies ?? 0),
      lastRunAt: rows[0]?.last_run_at ? rows[0].last_run_at.toISOString() : null,
      lastRunStatus: rows[0]?.last_run_status ?? null,
      staleLocks: Number(locks[0]?.count ?? 0),
    };
  } catch {
    return { configured, enabledCompanies: null, lastRunAt: null, lastRunStatus: null, staleLocks: null };
  }
}

function safeEnv() {
  try {
    const e = env();
    return {
      nodeEnv: e.NODE_ENV,
      demoMode: e.DEMO_MODE,
      intuitEnvironment: e.INTUIT_ENVIRONMENT,
      clientIdPresent: Boolean(e.INTUIT_CLIENT_ID),
      redirectUriConfigured: Boolean(e.INTUIT_REDIRECT_URI),
      quickbooksConfigured: isQuickBooksConfigured(),
      openAiConfigured: isOpenAiConfigured(),
      openAiModel: e.OPENAI_MODEL,
    };
  } catch {
    return {
      nodeEnv: 'unknown',
      demoMode: false,
      intuitEnvironment: 'unknown',
      clientIdPresent: false,
      redirectUriConfigured: false,
      quickbooksConfigured: false,
      openAiConfigured: false,
      openAiModel: null as string | null,
    };
  }
}
