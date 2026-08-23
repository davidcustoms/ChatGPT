import OpenAI from 'openai';
import { env, isOpenAiConfigured } from '../env';
import { AppError } from '../errors';
import { logger } from '../logger';

/**
 * Thin OpenAI wrapper with strict JSON-schema responses.
 *
 * The model is only ever asked to *explain* numbers that the application has
 * already computed. Prompts carry the verified figures; the schema forces the
 * model to attribute each claim to a supplied metric.
 */

let cached: OpenAI | null = null;

export function openai(): OpenAI {
  if (!isOpenAiConfigured()) {
    throw new AppError(
      'AI_UNAVAILABLE',
      'OpenAI is not configured. Set OPENAI_API_KEY to enable AI commentary.',
    );
  }
  if (!cached) cached = new OpenAI({ apiKey: env().OPENAI_API_KEY, maxRetries: 2, timeout: 90_000 });
  return cached;
}

export interface StructuredRequest {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
}

/** Calls the model and returns a parsed object matching `schema`. */
export async function structuredCompletion<T>(request: StructuredRequest): Promise<T> {
  const client = openai();
  const model = env().OPENAI_MODEL;
  try {
    const response = await client.chat.completions.create({
      model,
      temperature: request.temperature ?? 0.2,
      max_completion_tokens: request.maxTokens ?? 3000,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: request.schemaName,
          strict: true,
          schema: request.schema as Record<string, unknown>,
        },
      },
    });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new AppError('AI_ERROR', 'The AI returned an empty response.');
    return JSON.parse(content) as T;
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'AI request failed';
    logger.error('openai request failed', { message, model });
    throw new AppError('AI_ERROR', `AI analysis failed: ${message}`, { cause: err, retryable: true });
  }
}

export function aiModelName(): string {
  return env().OPENAI_MODEL;
}
