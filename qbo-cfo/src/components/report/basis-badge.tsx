import { Badge } from '@/components/ui/badge';

/**
 * Reporting-basis label.
 *
 * Shown on every surface that displays a figure, because accrual and cash
 * basis produce different numbers from the same ledger and an owner comparing
 * a dashboard against QuickBooks needs to know which one they are looking at.
 */
export function BasisBadge({
  method,
  label,
  description,
  className,
}: {
  method: string;
  label: string;
  description?: string;
  className?: string;
}) {
  return (
    <Badge
      variant={method === 'Cash' ? 'warning' : 'navy'}
      className={className}
      title={description}
    >
      {label}
    </Badge>
  );
}
