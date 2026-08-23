'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, type ButtonProps } from './button';

/**
 * Fires a JSON POST and refreshes the route on success. Errors are surfaced
 * inline rather than swallowed, and the button reports its own busy state.
 */
export function ActionButton({
  endpoint,
  body,
  children,
  pendingLabel = 'Working…',
  confirm,
  onDone,
  variant,
  size,
  className,
}: {
  endpoint: string;
  body?: Record<string, unknown>;
  children: React.ReactNode;
  pendingLabel?: string;
  confirm?: string;
  onDone?: (data: unknown) => void;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function run() {
    if (confirm && !window.confirm(confirm)) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const data = (await res.json()) as { error?: { message?: string }; warning?: string; warnings?: string[] };
      if (!res.ok) {
        setError(data.error?.message ?? `Request failed (${res.status}).`);
        return;
      }
      const warnings = [data.warning, ...(data.warnings ?? [])].filter(Boolean) as string[];
      if (warnings.length) setNotice(warnings.slice(0, 3).join(' '));
      onDone?.(data);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={className}>
      <Button type="button" onClick={run} disabled={pending} variant={variant} size={size}>
        {pending ? pendingLabel : children}
      </Button>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-negative">
          {error}
        </p>
      ) : null}
      {notice ? <p className="mt-1 max-w-md text-xs text-warning">{notice}</p> : null}
    </div>
  );
}
