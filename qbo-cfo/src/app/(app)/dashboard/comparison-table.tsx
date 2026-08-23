'use client';

import { ComparisonPicker } from '@/components/layout/period-picker';

export function ComparisonTable({
  options,
  active,
}: {
  options: Array<{ value: string; label: string }>;
  active: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs text-ink-muted">Compare against</span>
      <ComparisonPicker options={options} active={active} />
    </div>
  );
}
