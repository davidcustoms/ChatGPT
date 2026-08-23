import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4',
  {
    variants: {
      variant: {
        default: 'border-border bg-surface-muted text-ink-muted',
        navy: 'border-navy-200 bg-navy-50 text-navy-700',
        positive: 'border-transparent bg-positive-soft text-positive',
        negative: 'border-transparent bg-negative-soft text-negative',
        warning: 'border-transparent bg-warning-soft text-warning',
        info: 'border-transparent bg-info-soft text-info',
        outline: 'border-border-strong text-ink-muted',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** Maps an anomaly/insight severity onto a badge variant. */
export function severityVariant(severity: string): BadgeProps['variant'] {
  switch (severity) {
    case 'CRITICAL':
      return 'negative';
    case 'IMPORTANT':
      return 'warning';
    case 'WATCH':
      return 'info';
    default:
      return 'default';
  }
}
