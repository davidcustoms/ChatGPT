import * as React from 'react';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-5 flex flex-wrap items-end justify-between gap-3', className)}>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-navy-800">{title}</h1>
        {description ? <div className="mt-1 text-sm text-ink-muted">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function DataProvenance({
  dataThrough,
  source,
}: {
  dataThrough: string | null;
  source: string;
}) {
  return (
    <p className="text-xs text-ink-subtle">
      Data through: {dataThrough ?? '—'} · Source: {source}
    </p>
  );
}
