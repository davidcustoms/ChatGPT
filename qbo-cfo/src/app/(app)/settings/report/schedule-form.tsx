'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/field';
import { ErrorNotice } from '@/components/ui/states';
import { formatDateTime } from '@/lib/util/format';

interface Schedule {
  enabled: boolean;
  dayOfMonth: number;
  timezone: string;
  retentionMonths: number;
  lastRunAt: string | null;
  lastRunStatus: string | null;
}

export function ScheduleForm({ companyId, initial }: { companyId: string; initial: Schedule }) {
  const router = useRouter();
  const [form, setForm] = React.useState(initial);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/settings/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          enabled: form.enabled,
          dayOfMonth: Number(form.dayOfMonth),
          timezone: form.timezone,
          retentionMonths: Number(form.retentionMonths),
        }),
      });
      const data = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        setError(data.error?.message ?? 'Could not save the schedule.');
        return;
      }
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      {error ? <ErrorNotice message={error} /> : null}
      <label className="flex items-center gap-2 text-sm text-ink-muted">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          className="h-4 w-4"
        />
        Generate a report automatically each month
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="day-of-month">Day of month</Label>
          <Select
            id="day-of-month"
            value={form.dayOfMonth}
            onChange={(e) => setForm({ ...form, dayOfMonth: Number(e.target.value) })}
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
          <p className="text-xs text-ink-subtle">
            Day 3 gives your bookkeeper time to close the prior month.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="retention">Data retention (months)</Label>
          <Input
            id="retention"
            type="number"
            min={12}
            max={120}
            value={form.retentionMonths}
            onChange={(e) => setForm({ ...form, retentionMonths: Number(e.target.value) })}
          />
          <p className="text-xs text-ink-subtle">
            Raw QuickBooks snapshots older than this are pruned. Computed monthly metrics are kept.
          </p>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="timezone">Timezone</Label>
        <Input
          id="timezone"
          value={form.timezone}
          maxLength={64}
          onChange={(e) => setForm({ ...form, timezone: e.target.value })}
        />
      </div>
      {form.lastRunAt ? (
        <p className="text-xs text-ink-subtle">
          Last scheduled run: {formatDateTime(form.lastRunAt)} ({form.lastRunStatus ?? 'unknown'}).
        </p>
      ) : (
        <p className="text-xs text-ink-subtle">No scheduled run has happened yet.</p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save schedule'}
        </Button>
        {saved ? <span className="text-xs text-positive">Saved.</span> : null}
      </div>
    </form>
  );
}
