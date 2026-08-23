'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ErrorNotice } from '@/components/ui/states';
import { formatCurrency } from '@/lib/util/format';

interface Row {
  qboId: string;
  name: string;
  displayName: string | null;
  isStore: boolean;
  isActive: boolean;
  revenue: number | null;
}

export function LocationEditor({
  companyId,
  rows,
  currency,
}: {
  companyId: string;
  rows: Row[];
  currency: string;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = React.useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.qboId, r.displayName ?? r.name])),
  );
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function save(row: Row, patch: { displayName?: string | null; isStore?: boolean }) {
    setBusy(row.qboId);
    setError(null);
    try {
      const res = await fetch('/api/settings/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, qboId: row.qboId, ...patch }),
      });
      const data = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        setError(data.error?.message ?? 'Could not save.');
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {error ? <ErrorNotice message={error} /> : null}
      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>QuickBooks name</TH>
              <TH>Report name</TH>
              <TH className="text-right">Revenue this month</TH>
              <TH>Treat as store</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.qboId} className={!r.isActive ? 'opacity-60' : ''}>
                <TD className="text-sm">{r.name}</TD>
                <TD>
                  <Input
                    aria-label={`Report name for ${r.name}`}
                    value={drafts[r.qboId] ?? ''}
                    maxLength={120}
                    onChange={(e) => setDrafts({ ...drafts, [r.qboId]: e.target.value })}
                    className="h-8 w-48 text-xs"
                  />
                </TD>
                <TD className="text-right tnum text-sm">
                  {r.revenue === null ? '—' : formatCurrency(r.revenue, { currency })}
                </TD>
                <TD>
                  <label className="flex items-center gap-2 text-xs text-ink-muted">
                    <input
                      type="checkbox"
                      checked={r.isStore}
                      disabled={busy === r.qboId}
                      onChange={(e) => save(r, { isStore: e.target.checked })}
                      className="h-3.5 w-3.5"
                    />
                    Store
                  </label>
                </TD>
                <TD className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === r.qboId || (drafts[r.qboId] ?? '') === (r.displayName ?? r.name)}
                    onClick={() => save(r, { displayName: drafts[r.qboId] ?? null })}
                  >
                    {busy === r.qboId ? 'Saving…' : 'Save'}
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableWrap>
      <p className="text-xs text-ink-subtle">
        Report names apply the next time metrics are recomputed for a month.
      </p>
    </div>
  );
}
