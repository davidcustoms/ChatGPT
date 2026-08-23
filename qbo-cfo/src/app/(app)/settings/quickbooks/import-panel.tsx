'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/field';
import { ErrorNotice, WarningNotice } from '@/components/ui/states';

const PRESETS = [
  { value: '12', label: 'Last 12 months' },
  { value: '24', label: 'Last 24 months (default)' },
  { value: '36', label: 'Last 36 months' },
  { value: 'custom', label: 'Custom' },
];

/**
 * Historical import. The request runs synchronously and can take several
 * minutes for 36 months, so the panel reports progress and any per-month
 * warnings rather than failing the whole import.
 */
export function ImportHistoryPanel({ companyId, connected }: { companyId: string; connected: boolean }) {
  const router = useRouter();
  const [preset, setPreset] = React.useState('24');
  const [custom, setCustom] = React.useState(18);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [done, setDone] = React.useState<string | null>(null);

  const months = preset === 'custom' ? custom : Number(preset);

  async function run() {
    setPending(true);
    setError(null);
    setWarnings([]);
    setDone(null);
    try {
      const res = await fetch('/api/sync/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, months }),
      });
      const data = (await res.json()) as {
        error?: { message?: string };
        warnings?: string[];
        jobId?: string;
      };
      if (!res.ok) {
        setError(data.error?.message ?? `Import failed (${res.status}).`);
        return;
      }
      setWarnings(data.warnings ?? []);
      setDone(`Imported ${months} month(s).`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      {error ? <ErrorNotice title="Import failed" message={error} /> : null}
      {warnings.length > 0 ? (
        <WarningNotice>
          <p className="font-semibold">Completed with {warnings.length} warning(s)</p>
          <ul className="mt-1 max-h-40 list-disc space-y-0.5 overflow-auto pl-4 scrollbar-thin">
            {warnings.slice(0, 20).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </WarningNotice>
      ) : null}
      {done && warnings.length === 0 ? <p className="text-xs text-positive">{done}</p> : null}

      <div className="space-y-1.5">
        <Label htmlFor="import-range">History to import</Label>
        <Select id="import-range" value={preset} onChange={(e) => setPreset(e.target.value)}>
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      </div>

      {preset === 'custom' ? (
        <div className="space-y-1.5">
          <Label htmlFor="custom-months">Number of months (1–36)</Label>
          <Input
            id="custom-months"
            type="number"
            min={1}
            max={36}
            value={custom}
            onChange={(e) => setCustom(Math.max(1, Math.min(36, Number(e.target.value))))}
          />
        </div>
      ) : null}

      <Button onClick={run} disabled={pending || !connected} className="w-full">
        {pending ? `Importing ${months} months…` : 'Import historical data'}
      </Button>
      {!connected ? (
        <p className="text-xs text-ink-subtle">Connect QuickBooks first.</p>
      ) : (
        <p className="text-xs text-ink-subtle">
          Each month pulls the Profit &amp; Loss, Balance Sheet, aging summaries, the location or class breakdown
          and transaction detail. 36 months can take several minutes.
        </p>
      )}
    </div>
  );
}
