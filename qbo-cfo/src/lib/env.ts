import { z } from 'zod';

/**
 * Server-side environment access.
 *
 * Nothing here may be imported from a client component: the module reads
 * secrets (Intuit client secret, encryption key, OpenAI key) that must never
 * be serialised into the browser bundle.
 */

const serverSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),

  INTUIT_CLIENT_ID: z.string().default(''),
  INTUIT_CLIENT_SECRET: z.string().default(''),
  INTUIT_REDIRECT_URI: z.string().default(''),
  INTUIT_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),

  OPENAI_API_KEY: z.string().default(''),
  OPENAI_MODEL: z.string().default('gpt-4.1'),

  TOKEN_ENCRYPTION_KEY: z.string().default(''),
  SESSION_SECRET: z.string().default(''),
  CRON_SECRET: z.string().default(''),

  OWNER_EMAIL: z.string().default('owner@example.com'),
  OWNER_PASSWORD: z.string().default(''),

  DEMO_MODE: z
    .string()
    .default('true')
    .transform((v) => v.toLowerCase() === 'true' || v === '1'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Reset the memoised env (tests only). */
export function resetEnvCache(): void {
  cached = null;
}

/** True when Intuit OAuth is fully configured. */
export function isQuickBooksConfigured(): boolean {
  const e = env();
  return Boolean(e.INTUIT_CLIENT_ID && e.INTUIT_CLIENT_SECRET && e.INTUIT_REDIRECT_URI);
}

export function isOpenAiConfigured(): boolean {
  return Boolean(env().OPENAI_API_KEY);
}

/** Intuit API hosts differ between sandbox and production. */
export function intuitApiBaseUrl(environment?: 'sandbox' | 'production'): string {
  const target = environment ?? env().INTUIT_ENVIRONMENT;
  return target === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

export const INTUIT_AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
export const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
export const INTUIT_REVOKE_URL =
  'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';

/**
 * Least-privilege scopes. `com.intuit.quickbooks.accounting` is the narrowest
 * scope Intuit exposes that still permits reading reports and entities; the
 * application never issues a write request against it.
 */
export const INTUIT_SCOPES = ['com.intuit.quickbooks.accounting', 'openid', 'profile', 'email'];
