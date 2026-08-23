import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AppError, toErrorPayload } from './errors';
import { logger } from './logger';

/** Wraps a route handler with consistent error shaping and logging. */
export function handler<T>(fn: () => Promise<T>): Promise<NextResponse> {
  return fn()
    .then((data) => NextResponse.json(data as Record<string, unknown>))
    .catch((err) => {
      const { error, status } = toErrorPayload(err);
      if (status >= 500) {
        logger.error('api error', {
          code: error.code,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      return NextResponse.json({ error }, { status });
    });
}

/** Parses and validates a JSON body, converting Zod issues into AppError. */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError('VALIDATION', 'Request body must be valid JSON.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid request.', {
      details: parsed.error.issues,
    });
  }
  return parsed.data;
}

export const periodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Period must be in YYYY-MM form.');

export const companyIdSchema = z.string().uuid('A valid company id is required.');

/**
 * Strips control characters and collapses whitespace before free text is
 * stored, logged, or echoed back into a page.
 */
export function sanitizeText(value: string, maxLength = 2000): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLength);
}
