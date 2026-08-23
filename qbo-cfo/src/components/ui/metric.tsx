import * as React from 'react';
import { cn } from '@/lib/utils';
import { formatCurrency, formatPercent, formatPoints, NOT_MEANINGFUL } from '@/lib/util/format';

/**
 * KPI card. A missing or not-meaningful comparison renders "N/M" rather than a
 * fabricated percentage, so an owner is never shown a misleading move.
 */
export function MetricCard({
  label,
  value,
  format = 'currency',
  currency = 'USD',
  changePct,
  changePoints,
  changeAmount,
  comparisonLabel = 'vs prior month',
  /** true when a decrease is the good outcome (e.g. expenses). */
  invert = false,
  href,
  className,
}: {
  label: string;
  value: number | null;
  format?: 'currency' | 'percent' | 'ratio';
  currency?: string;
  changePct?: number | null;
  changePoints?: number | null;
  changeAmount?: number | null;
  comparisonLabel?: string;
  invert?: boolean;
  href?: string;
  className?: string;
}) {
  const display =
    format === 'percent'
      ? formatPercent(value)
      : format === 'ratio'
        ? (value === null || !Number.isFinite(value) ? NOT_MEANINGFUL : value.toFixed(2))
        : formatCurrency(value, { currency });

  const movement = changePoints ?? changePct ?? null;
  const tone =
    movement === null || movement === 0
      ? 'text-ink-subtle'
      : (invert ? movement < 0 : movement > 0)
        ? 'text-positive'
        : 'text-negative';

  const changeText =
    changePoints !== undefined && changePoints !== null
      ? `${formatPoints(changePoints)} ${comparisonLabel}`
      : changePct !== undefined
        ? `${formatPercent(changePct, 1, { signed: true })} ${comparisonLabel}`
        : null;

  const body = (
    <>
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tnum text-navy-800">{display}</p>
      {changeText ? (
        <p className={cn('mt-1 text-xs tnum', tone)}>
          {changeText}
          {changeAmount !== undefined && changeAmount !== null
            ? ` (${formatCurrency(changeAmount, { currency })})`
            : ''}
        </p>
      ) : (
        <p className="mt-1 text-xs text-ink-subtle">No comparison available</p>
      )}
    </>
  );

  const classes = cn(
    'rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)]',
    href && 'transition-colors hover:border-navy-200 hover:bg-navy-50/40',
    className,
  );

  if (href) {
    return (
      <a href={href} className={classes}>
        {body}
      </a>
    );
  }
  return <div className={classes}>{body}</div>;
}

/** Inline signed change, used inside tables. */
export function Delta({
  value,
  format = 'percent',
  invert = false,
  currency = 'USD',
}: {
  value: number | null;
  format?: 'percent' | 'currency' | 'points';
  invert?: boolean;
  currency?: string;
}) {
  if (value === null || !Number.isFinite(value)) {
    return <span className="tnum text-ink-subtle">{NOT_MEANINGFUL}</span>;
  }
  const tone = value === 0 ? 'text-ink-subtle' : (invert ? value < 0 : value > 0) ? 'text-positive' : 'text-negative';
  const text =
    format === 'percent'
      ? formatPercent(value, 1, { signed: true })
      : format === 'points'
        ? formatPoints(value)
        : `${value > 0 ? '+' : value < 0 ? '-' : ''}${formatCurrency(Math.abs(value), { currency })}`;
  return <span className={cn('tnum', tone)}>{text}</span>;
}
