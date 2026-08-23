import pkg from '../../package.json';

/**
 * Identity stamped onto every generated report so any historical output can be
 * reproduced and audited.
 *
 * `AI_PROMPT_VERSION` must be bumped whenever the text in `src/lib/ai/prompts.ts`
 * changes. A test asserts the prompts' checksum against the value recorded here,
 * so an edit that forgets to bump the version fails CI rather than silently
 * invalidating the audit trail.
 */

export const APP_VERSION: string = (pkg as { version?: string }).version ?? '0.0.0';

/** Version of the CFO analysis system prompt. */
export const AI_PROMPT_VERSION = 'cfo_system_prompt_v1.0';

/** Version of the chat narration system prompt. */
export const CHAT_PROMPT_VERSION = 'cfo_chat_prompt_v1.0';

/** Recorded when no model was involved and commentary is application-written. */
export const DETERMINISTIC_PROMPT_VERSION = 'deterministic_v1.0';
