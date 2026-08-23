'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/util/format';

/**
 * Shown when QuickBooks data or the account mapping changed after this report
 * was generated.
 *
 * The report itself is never rewritten in place: what an owner was told on the
 * 3rd of the month remains on the record. Regenerating appends a new version
 * and leaves the original readable in the version history.
 */
export function RegenerateBanner({
  companyId,
  period,
  message,
  generatedAt,
  version,
}: {
  companyId: string;
  period: string;
  message: string;
  generatedAt: string;
  version: number;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (dismissed) return null;

  async function regenerate() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, period }),
      });
      const data = (await res.json()) as { error?: { message?: string }; reportId?: string };
      if (!res.ok) {
        setError(data.error?.message ?? 'Could not regenerate the report.');
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      role="status"
      className="mb-4 rounded-[var(--radius-card)] border border-warning/30 bg-warning-soft px-4 py-3"
    >
      <p className="text-sm font-semibold text-warning">{message}</p>
      <p className="mt-1 text-xs text-warning/90">
        This is version {version}, generated {formatDateTime(generatedAt)}. Keeping it preserves exactly what was
        reported at the time. Regenerating adds a new version and leaves this one in the history.
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-negative">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={regenerate} disabled={pending}>
          {pending ? 'Regenerating…' : 'Regenerate report'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setDismissed(true)} disabled={pending}>
          Keep original report
        </Button>
      </div>
    </div>
  );
}
