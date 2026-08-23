'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Select } from '@/components/ui/field';

/** Reporting-month selector shared by the dashboard and analysis pages. */
export function PeriodPicker({
  periods,
  active,
  label = 'Reporting month',
}: {
  periods: Array<{ value: string; label: string }>;
  active: string;
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <label className="flex items-center gap-2 text-xs text-ink-muted">
      {label}
      <Select
        value={active}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          next.set('period', e.target.value);
          router.push(`${pathname}?${next.toString()}`);
        }}
        className="h-8 w-40 text-xs"
      >
        {periods.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </Select>
    </label>
  );
}

export function ComparisonPicker({
  active,
  options,
}: {
  active: string;
  options: Array<{ value: string; label: string }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <div role="group" aria-label="Comparison basis" className="inline-flex rounded-md border border-border bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={active === o.value}
          onClick={() => {
            const next = new URLSearchParams(params.toString());
            next.set('compare', o.value);
            router.push(`${pathname}?${next.toString()}`);
          }}
          className={`rounded px-2.5 py-1 text-xs transition-colors ${
            active === o.value ? 'bg-navy-700 text-white' : 'text-ink-muted hover:bg-surface-muted'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
