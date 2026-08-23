'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/field';
import { ErrorNotice } from '@/components/ui/states';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function CompanySettingsForm({
  companyId,
  initial,
}: {
  companyId: string;
  initial: {
    name: string;
    fiscalYearStartMonth: number;
    currencyCode: string;
    trackingDimension: 'auto' | 'location' | 'class' | 'none';
    materialityAmount: number;
    materialityPct: number;
  };
}) {
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
      const res = await fetch('/api/settings/company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          name: form.name,
          fiscalYearStartMonth: Number(form.fiscalYearStartMonth),
          currencyCode: form.currencyCode,
          trackingDimension: form.trackingDimension,
          materialityAmount: Number(form.materialityAmount),
          materialityPct: Number(form.materialityPct),
        }),
      });
      const data = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        setError(data.error?.message ?? 'Could not save settings.');
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
      <div className="space-y-1.5">
        <Label htmlFor="company-name">Company name</Label>
        <Input
          id="company-name"
          value={form.name}
          maxLength={200}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="fiscal-month">Fiscal year starts</Label>
          <Select
            id="fiscal-month"
            value={form.fiscalYearStartMonth}
            onChange={(e) => setForm({ ...form, fiscalYearStartMonth: Number(e.target.value) })}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="currency">Currency</Label>
          <Input
            id="currency"
            value={form.currencyCode}
            maxLength={3}
            onChange={(e) => setForm({ ...form, currencyCode: e.target.value.toUpperCase() })}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dimension">Store tracking dimension</Label>
        <Select
          id="dimension"
          value={form.trackingDimension}
          onChange={(e) =>
            setForm({ ...form, trackingDimension: e.target.value as typeof form.trackingDimension })
          }
        >
          <option value="auto">Auto-detect (Locations, then Classes)</option>
          <option value="location">QuickBooks Locations (Departments)</option>
          <option value="class">QuickBooks Classes</option>
          <option value="none">No store-level reporting</option>
        </Select>
        <p className="text-xs text-ink-subtle">
          Determines how store-level results are produced. Changing it takes effect on the next sync.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="materiality-amount">Materiality — dollar threshold</Label>
          <Input
            id="materiality-amount"
            type="number"
            min={0}
            step={100}
            value={form.materialityAmount}
            onChange={(e) => setForm({ ...form, materialityAmount: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="materiality-pct">Materiality — percentage threshold</Label>
          <Input
            id="materiality-pct"
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={form.materialityPct}
            onChange={(e) => setForm({ ...form, materialityPct: Number(e.target.value) })}
          />
          <p className="text-xs text-ink-subtle">Expressed as a ratio: 0.10 means 10%.</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save settings'}
        </Button>
        {saved ? <span className="text-xs text-positive">Saved.</span> : null}
      </div>
    </form>
  );
}
