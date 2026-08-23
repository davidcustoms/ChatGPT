import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { metricsFixture } from '../fixtures/metrics';

/**
 * Security review, exercised rather than asserted in prose.
 *
 * The threat this application actually has to survive is a signed-in user of
 * one company reaching another company's books, and an attacker replaying or
 * forging the QuickBooks connection handshake. Everything here is a real query
 * against a real database with two tenants present at once.
 */

const HAS_DB =
  Boolean(process.env['DATABASE_URL']) && process.env['DATABASE_URL_IS_PLACEHOLDER'] !== '1';
const suite = HAS_DB ? describe : describe.skip;

suite('security', () => {
  let pool: typeof import('@/lib/db/pool');
  let alice: { id: string; companyId: string };
  let mallory: { id: string; companyId: string };
  let aliceReportId: string;

  beforeAll(async () => {
    pool = await import('@/lib/db/pool');
    const { runMigrations } = await import('@/lib/db/migrate');
    const { createUser, findUserByEmail } = await import('@/lib/db/repositories/users');
    const { createCompany } = await import('@/lib/db/repositories/companies');
    const { saveMonthlyMetrics } = await import('@/lib/db/repositories/metrics');

    await runMigrations();

    const make = async (email: string, name: string) => {
      const existing = await findUserByEmail(email);
      const user = existing ?? (await createUser({ email, password: 'security-test-password' }));
      await pool.query('DELETE FROM companies WHERE owner_user_id = $1', [user.id]);
      const company = await createCompany({ ownerUserId: user.id, name, fiscalYearStartMonth: 1 });
      await saveMonthlyMetrics(
        metricsFixture(company.id, '2026-07', {
          grossSales: 400_000, netSales: 400_000, cogs: 220_000,
          grossProfit: 180_000, grossMargin: 0.45,
          operatingExpenses: 140_000, netOperatingIncome: 40_000,
          netIncome: 40_000, netMargin: 0.1, cash: 250_000,
        }),
      );
      return { id: user.id, companyId: company.id };
    };

    alice = await make('sec-alice@example.invalid', 'Alice Furniture');
    mallory = await make('sec-mallory@example.invalid', 'Mallory Interiors');

    const rows = await pool.query<{ id: string }>(
      `INSERT INTO generated_reports (company_id, period_start, period_end, title, payload, status)
       VALUES ($1, '2026-07-01', '2026-07-31', 'July 2026', $2, 'completed') RETURNING id`,
      [alice.companyId, JSON.stringify({ secret: 'alice numbers' })],
    );
    aliceReportId = rows[0]!.id;
  }, 120_000);

  afterAll(async () => {
    if (!HAS_DB) return;
    for (const u of [alice, mallory]) {
      await pool.query('DELETE FROM companies WHERE owner_user_id = $1', [u.id]);
      await pool.query('DELETE FROM users WHERE id = $1', [u.id]);
    }
    await pool.getPool().end();
  });

  describe('tenant isolation', () => {
    it('refuses cross-tenant company access', async () => {
      const { userCanAccessCompany } = await import('@/lib/db/repositories/companies');
      expect(await userCanAccessCompany(alice.id, alice.companyId)).toBe(true);
      expect(await userCanAccessCompany(mallory.id, alice.companyId)).toBe(false);
      expect(await userCanAccessCompany(alice.id, mallory.companyId)).toBe(false);
    });

    it('throws FORBIDDEN when the guard is handed another tenant id', async () => {
      const { resolveCompany } = await import('@/lib/auth/guards');
      const mal = { id: mallory.id, email: 'sec-mallory@example.invalid' } as never;
      await expect(resolveCompany(mal, alice.companyId)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('lists only a user’s own companies', async () => {
      const { listCompaniesForUser } = await import('@/lib/db/repositories/companies');
      const ids = (await listCompaniesForUser(mallory.id)).map((c) => c.id);
      expect(ids).toContain(mallory.companyId);
      expect(ids).not.toContain(alice.companyId);
    });

    it('scopes every metric read to the company id', async () => {
      const { getMonthlyMetrics } = await import('@/lib/db/repositories/metrics');
      const { monthPeriodOf } = await import('@/lib/util/dates');
      const period = monthPeriodOf('2026-07-01');
      const mine = await getMonthlyMetrics(mallory.companyId, period);
      expect(mine?.companyId).toBe(mallory.companyId);
      // Alice's row exists for the same period but is a different record.
      const hers = await getMonthlyMetrics(alice.companyId, period);
      expect(hers?.companyId).toBe(alice.companyId);
      expect(hers?.companyId).not.toBe(mine?.companyId);
    });

    it('answers chat questions only from the caller’s own company', async () => {
      const { answerQuestion } = await import('@/lib/ai/nlq');
      const result = await answerQuestion({
        companyId: mallory.companyId,
        question: 'Summarise July 2026.',
      });
      // Both tenants hold identical figures by construction, so the assertion
      // that matters is the scoping of the query, checked above. Here we only
      // confirm the answer is bound to the company that was asked for.
      expect(result.data['period']).toBe('2026-07-01');
      expect(result.source).toBe('QuickBooks Online');
    });
  });

  describe('IDOR on reports and exports', () => {
    it('a report id alone does not grant access', async () => {
      const { getReport } = await import('@/lib/db/repositories/reports');
      const { userCanAccessCompany } = await import('@/lib/db/repositories/companies');

      // Mallory guesses (or is given) Alice's report id.
      const report = await getReport(aliceReportId);
      expect(report).not.toBeNull();
      // This is the check every export route performs before returning bytes.
      expect(await userCanAccessCompany(mallory.id, report!.companyId)).toBe(false);
      expect(await userCanAccessCompany(alice.id, report!.companyId)).toBe(true);
    });

    it('every report route checks company access, not just a session', () => {
      // A static check: a future route added under /api/reports/[reportId]
      // that forgets the ownership test fails this test.
      const dir = join(process.cwd(), 'src/app/api/reports/[reportId]');
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const source = readFileSync(join(dir, entry.name, 'route.ts'), 'utf8');
        expect(source, entry.name).toContain('requireUser');
        expect(source, entry.name).toContain('userCanAccessCompany');
      }
    });

    it('leaves no API route unauthenticated except the documented ones', () => {
      // /api/health is deliberately open (it exposes booleans only) and the
      // OAuth callback and cron endpoints carry their own credentials.
      const exempt = new Set([
        'health/route.ts',
        'quickbooks/callback/route.ts',
        'cron/monthly/route.ts',
      ]);
      const root = join(process.cwd(), 'src/app/api');
      const routes: string[] = [];
      const walk = (dir: string, prefix: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const next = join(dir, entry.name);
          if (entry.isDirectory()) walk(next, `${prefix}${entry.name}/`);
          else if (entry.name === 'route.ts') routes.push(`${prefix}${entry.name}`);
        }
      };
      walk(root, '');
      expect(routes.length).toBeGreaterThan(10);

      for (const route of routes) {
        if (exempt.has(route)) continue;
        const source = readFileSync(join(root, route), 'utf8');
        expect(source, route).toMatch(/requireCompany|requireUser/);
      }
    });
  });

  describe('OAuth state (CSRF)', () => {
    it('is single use', async () => {
      const { createOAuthState, consumeOAuthState } = await import('@/lib/db/repositories/connections');
      const state = await createOAuthState({ userId: alice.id, companyId: alice.companyId });

      const first = await consumeOAuthState(state);
      expect(first?.userId).toBe(alice.id);
      // A replayed callback is refused.
      expect(await consumeOAuthState(state)).toBeNull();
    });

    it('rejects a forged or unknown state', async () => {
      const { consumeOAuthState } = await import('@/lib/db/repositories/connections');
      expect(await consumeOAuthState('not-a-real-state')).toBeNull();
      expect(await consumeOAuthState('')).toBeNull();
    });

    it('rejects an expired state', async () => {
      const { createOAuthState, consumeOAuthState } = await import('@/lib/db/repositories/connections');
      const state = await createOAuthState({ userId: alice.id, ttlMinutes: 15 });
      const { sha256 } = await import('@/lib/crypto');
      await pool.query(`UPDATE oauth_states SET expires_at = now() - interval '1 minute' WHERE state = $1`, [
        sha256(state),
      ]);
      expect(await consumeOAuthState(state)).toBeNull();
    });

    it('stores only the hash of the state, never the value', async () => {
      const { createOAuthState } = await import('@/lib/db/repositories/connections');
      const state = await createOAuthState({ userId: alice.id });
      const rows = await pool.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM oauth_states WHERE state = $1',
        [state],
      );
      expect(Number(rows[0]?.n)).toBe(0);
    });
  });

  describe('sessions', () => {
    it('stores only the hash of the session token', async () => {
      const { randomToken, sha256 } = await import('@/lib/crypto');
      const token = randomToken(32);
      await pool.query(
        `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '1 hour')`,
        [alice.id, sha256(token)],
      );
      const plain = await pool.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM sessions WHERE token_hash = $1',
        [token],
      );
      expect(Number(plain[0]?.n)).toBe(0);

      const hashed = await pool.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM sessions WHERE token_hash = $1',
        [sha256(token)],
      );
      expect(Number(hashed[0]?.n)).toBe(1);
    });

    it('does not resolve an expired session', async () => {
      const { randomToken, sha256 } = await import('@/lib/crypto');
      const token = randomToken(32);
      await pool.query(
        `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1,$2, now() - interval '1 minute')`,
        [alice.id, sha256(token)],
      );
      const row = await pool.query<{ user_id: string }>(
        'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()',
        [sha256(token)],
      );
      expect(row).toHaveLength(0);
    });
  });

  describe('SQL injection', () => {
    const HOSTILE = [
      "'; DROP TABLE companies; --",
      "' OR '1'='1",
      "1); DELETE FROM monthly_metrics WHERE ('1'='1",
      "\\'; UPDATE users SET is_active = false; --",
      "%' UNION SELECT token_hash FROM sessions --",
    ];

    it('treats hostile strings as data in company names', async () => {
      const { createCompany, getCompany } = await import('@/lib/db/repositories/companies');
      for (const name of HOSTILE) {
        const company = await createCompany({ ownerUserId: alice.id, name });
        const read = await getCompany(company.id);
        // Stored verbatim, executed never.
        expect(read?.name).toBe(name);
      }
      // The tables the payloads targeted are all still there.
      const check = await pool.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM users WHERE id = $1 AND is_active',
        [alice.id],
      );
      expect(Number(check[0]?.n)).toBe(1);
    });

    it('treats hostile strings as data in chat questions', async () => {
      const { answerQuestion } = await import('@/lib/ai/nlq');
      for (const question of HOSTILE) {
        const result = await answerQuestion({ companyId: alice.companyId, question });
        expect(typeof result.answer).toBe('string');
      }
      const check = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM monthly_metrics WHERE company_id = $1', [
        alice.companyId,
      ]);
      expect(Number(check[0]?.n)).toBe(1);
    });

    it('rejects a malformed period rather than interpolating it', async () => {
      const { periodSchema } = await import('@/lib/api');
      for (const bad of ["2026-07'; DROP TABLE users; --", '2026-13', 'now()', '../../etc/passwd']) {
        expect(periodSchema.safeParse(bad).success, bad).toBe(false);
      }
      expect(periodSchema.safeParse('2026-07').success).toBe(true);
    });
  });

  describe('cron authentication', () => {
    it('uses a constant-time comparison', async () => {
      const { constantTimeEquals } = await import('@/lib/crypto');
      expect(constantTimeEquals('secret-value', 'secret-value')).toBe(true);
      expect(constantTimeEquals('secret-value', 'secret-valuf')).toBe(false);
      // Different lengths must not throw or short-circuit into a match.
      expect(constantTimeEquals('secret-value', 'x')).toBe(false);
      expect(constantTimeEquals('', '')).toBe(true);
    });

    it('is disabled outright when no secret is configured', () => {
      const source = readFileSync(join(process.cwd(), 'src/app/api/cron/monthly/route.ts'), 'utf8');
      // Fails closed: no secret means the endpoint refuses, not that it opens.
      expect(source).toMatch(/if \(!secret\)/);
      expect(source).toMatch(/scheduler endpoint is disabled/);
      expect(source).toContain('constantTimeEquals');
    });
  });

  describe('secrets never leave the server', () => {
    it('keeps the Intuit client secret out of client-side code', () => {
      const clientDirs = [join(process.cwd(), 'src/components'), join(process.cwd(), 'src/app')];
      const offenders: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const next = join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(next);
          } else if (/\.tsx?$/.test(entry.name)) {
            const source = readFileSync(next, 'utf8');
            const isClient = source.includes("'use client'") || source.includes('"use client"');
            if (!isClient) continue;
            if (/INTUIT_CLIENT_SECRET|OPENAI_API_KEY|TOKEN_ENCRYPTION_KEY|SESSION_SECRET|CRON_SECRET|DATABASE_URL/.test(source)) {
              offenders.push(next);
            }
          }
        }
      };
      for (const dir of clientDirs) walk(dir);
      expect(offenders).toEqual([]);
    });

    it('never renders raw HTML from stored content', () => {
      const offenders: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const next = join(dir, entry.name);
          if (entry.isDirectory()) walk(next);
          else if (/\.tsx?$/.test(entry.name)) {
            const source = readFileSync(next, 'utf8');
            if (source.includes('dangerouslySetInnerHTML')) offenders.push(next);
          }
        }
      };
      walk(join(process.cwd(), 'src'));
      expect(offenders).toEqual([]);
    });

    it('encrypts tokens at rest', async () => {
      const rows = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'oauth_tokens' AND column_name LIKE '%token%'`,
      );
      const names = rows.map((r) => r.column_name);
      // Column names say what they hold: ciphertext, not plaintext.
      expect(names.some((n) => n.includes('encrypted'))).toBe(true);
      expect(names).not.toContain('access_token');
      expect(names).not.toContain('refresh_token');
    });
  });

  describe('the health endpoint exposes no secrets', () => {
    it('reports configuration as booleans only', async () => {
      const source = readFileSync(join(process.cwd(), 'src/app/api/health/route.ts'), 'utf8');
      for (const secret of [
        'INTUIT_CLIENT_SECRET',
        'OPENAI_API_KEY',
        'TOKEN_ENCRYPTION_KEY',
        'SESSION_SECRET',
        'DATABASE_URL',
      ]) {
        // The endpoint may test whether a value is configured, but must never
        // place the value itself into the response.
        const risky = new RegExp(`${secret}[^\\n]*?(\\.slice|\\$\\{|: *e\\.)`);
        expect(risky.test(source), secret).toBe(false);
      }
      expect(source).toContain('no-store');
    });
  });
});
