'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Select } from '@/components/ui/field';

export function CompanySwitcher({
  companies,
}: {
  companies: Array<{ id: string; name: string; isDemo: boolean }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const active = params.get('company') ?? companies[0]?.id ?? '';

  if (companies.length <= 1) return null;

  return (
    <label className="flex items-center gap-2 text-xs text-ink-muted">
      <span className="sr-only">Active company</span>
      <Select
        value={active}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          next.set('company', e.target.value);
          next.delete('period');
          router.push(`${pathname}?${next.toString()}`);
        }}
        className="h-8 w-56 text-xs"
      >
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.isDemo ? ' — demo' : ''}
          </option>
        ))}
      </Select>
    </label>
  );
}
