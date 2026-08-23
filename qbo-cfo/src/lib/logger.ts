import { redact } from './crypto';

type Level = 'debug' | 'info' | 'warn' | 'error';

interface LogFields {
  [key: string]: unknown;
}

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]';
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/token|secret|password|authorization|api_key|apikey/i.test(k)) {
        out[k] = '[redacted]';
      } else {
        out[k] = scrub(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

function emit(level: Level, message: string, fields?: LogFields): void {
  const line = {
    level,
    ts: new Date().toISOString(),
    msg: redact(message),
    ...(fields ? (scrub(fields) as LogFields) : {}),
  };
  const serialised = JSON.stringify(line);
  if (level === 'error') console.error(serialised);
  else if (level === 'warn') console.warn(serialised);
  else console.log(serialised);
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => {
    if (process.env.NODE_ENV !== 'production') emit('debug', msg, fields);
  },
  info: (msg: string, fields?: LogFields) => emit('info', msg, fields),
  warn: (msg: string, fields?: LogFields) => emit('warn', msg, fields),
  error: (msg: string, fields?: LogFields) => emit('error', msg, fields),
};
