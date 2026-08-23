'use client';

import * as React from 'react';
import { formatCurrency, formatPercent } from '@/lib/util/format';

export type ValueFormat = 'currency' | 'percent' | 'number';

export function formatValue(value: number | null | undefined, format: ValueFormat): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (format === 'percent') return formatPercent(value);
  if (format === 'currency') return formatCurrency(value);
  return new Intl.NumberFormat('en-US').format(value);
}

interface PayloadEntry {
  name?: string;
  value?: number;
  color?: string;
  dataKey?: string | number;
}

/** Shared tooltip: text in ink tokens, a colour swatch carries series identity. */
export function ChartTooltip({
  active,
  payload,
  label,
  formats,
}: {
  active?: boolean;
  payload?: PayloadEntry[];
  label?: string | number;
  formats?: Record<string, ValueFormat>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      {label !== undefined ? <p className="mb-1 font-semibold text-ink">{label}</p> : null}
      <ul className="space-y-0.5">
        {payload.map((entry, i) => (
          <li key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-muted">
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 rounded-sm"
                style={{ backgroundColor: entry.color }}
              />
              {entry.name}
            </span>
            <span className="tnum font-medium text-ink">
              {formatValue(entry.value, formats?.[String(entry.dataKey ?? entry.name)] ?? 'currency')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function compactCurrency(value: number): string {
  return formatCurrency(value, { compact: Math.abs(value) >= 10_000 });
}

export function percentTick(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}
