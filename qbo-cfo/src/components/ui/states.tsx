import * as React from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from './card';

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('border-dashed', className)}>
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
        {icon ? <div className="text-ink-subtle">{icon}</div> : null}
        <p className="text-sm font-medium text-ink">{title}</p>
        {description ? <p className="max-w-md text-xs text-ink-muted">{description}</p> : null}
        {action ? <div className="pt-2">{action}</div> : null}
      </CardContent>
    </Card>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-surface-muted', className)} />;
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function ErrorNotice({
  title = 'Something went wrong',
  message,
  action,
}: {
  title?: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div role="alert" className="rounded-[var(--radius-card)] border border-negative/30 bg-negative-soft px-4 py-3">
      <p className="text-sm font-semibold text-negative">{title}</p>
      <p className="mt-1 text-xs text-negative/90">{message}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function InfoNotice({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-[var(--radius-card)] border border-info/25 bg-info-soft px-4 py-3 text-xs text-info', className)}>
      {children}
    </div>
  );
}

export function WarningNotice({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-[var(--radius-card)] border border-warning/25 bg-warning-soft px-4 py-3 text-xs text-warning', className)}>
      {children}
    </div>
  );
}
