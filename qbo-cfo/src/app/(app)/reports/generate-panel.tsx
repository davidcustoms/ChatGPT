'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Label, Select } from '@/components/ui/field';
import { ErrorNotice, WarningNotice } from '@/components/ui/states';

/**
 * Generation panel. Reports run synchronously and can take a minute when a
 * QuickBooks sync is included, so the button reports each stage.
 */
export function GenerateReportPanel({
  companyId,
  periods,
  defaultPeriod,
  canSync,
}: {
  companyId: string;
  periods: Array<{ value: string; label: string }>;
  defaultPeriod: string;
  canSync: boolean;
}) {
  const router = useRouter();
  const [period, setPeriod] = React.useState(defaultPeriod);
  const [sync, setSync] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [warnings, setWarnings] = React.useState<string[]>([]);

  async function generate() {
    setPending(true);
    setError(null);
    setWarnings([]);
    try {
      const res = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, period, sync }),
      });
      const data = (await res.json()) as {
        error?: { message?: string };
        reportId?: string;
        warning?: string | null;
        warnings?: string[];
        message?: string;
      };
      if (!res.ok) {
        setError(data.error?.message ?? `Generation failed (${res.status}).`);
        return;
      }
      const collected = [data.warning, ...(data.warnings ?? []), data.message].filter(Boolean) as string[];
      if (collected.length) setWarnings(collected);
      if (data.reportId) router.push(`/reports/${data.reportId}`);
      else router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      {error ? <ErrorNotice title="Could not generate the report" message={error} /> : null}
      {warnings.length > 0 ? (
        <WarningNotice>
          <ul className="list-disc space-y-0.5 pl-4">
            {warnings.slice(0, 5).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </WarningNotice>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="report-period">Reporting month</Label>
        <Select id="report-period" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {periods.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      </div>

      {canSync ? (
        <label className="flex items-start gap-2 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={sync}
            onChange={(e) => setSync(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5"
          />
          <span>
            Refresh this month from QuickBooks first. Slower, but guarantees the report reflects the latest
            bookkeeping.
          </span>
        </label>
      ) : null}

      <Button onClick={generate} disabled={pending || periods.length === 0} className="w-full">
        {pending ? (sync ? 'Syncing and generating…' : 'Generating…') : 'Generate report'}
      </Button>
    </div>
  );
}
