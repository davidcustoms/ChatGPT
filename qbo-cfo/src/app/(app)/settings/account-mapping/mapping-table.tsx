'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ErrorNotice } from '@/components/ui/states';
import { formatCurrency, formatPercent } from '@/lib/util/format';

export interface MappingRow {
  accountQboId: string;
  accountName: string;
  accountNumber: string | null;
  accountType: string;
  accountSubType: string | null;
  isActive: boolean;
  categoryKey: string | null;
  confidence: number | null;
  approved: boolean;
  source: string | null;
  suggestedReason: string | null;
  currentMonthAmount: number;
}

type Filter = 'all' | 'pending' | 'unmapped' | 'mapped';

export function MappingTable({
  companyId,
  rows,
  categories,
  currency,
}: {
  companyId: string;
  rows: MappingRow[];
  categories: Array<{ key: string; label: string; section: string }>;
  currency: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = React.useState<Filter>('all');
  const [search, setSearch] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const filtered = rows.filter((r) => {
    if (search && !`${r.accountName} ${r.accountNumber ?? ''}`.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    if (filter === 'pending') return Boolean(r.categoryKey) && !r.approved;
    if (filter === 'unmapped') return !r.categoryKey;
    if (filter === 'mapped') return r.approved;
    return true;
  });

  async function send(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/settings/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, ...body }),
      });
      const data = (await res.json()) as { error?: { message?: string }; recomputed?: number };
      if (!res.ok) {
        setError(data.error?.message ?? 'Could not save the mapping.');
        return;
      }
      if (data.recomputed) setNotice(`Recomputed ${data.recomputed} month(s) with the new mapping.`);
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
      {notice ? <p className="text-xs text-positive">{notice}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search accounts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-64 text-xs"
          aria-label="Search accounts"
        />
        <div role="group" aria-label="Filter" className="inline-flex rounded-md border border-border bg-surface p-0.5">
          {(['all', 'pending', 'unmapped', 'mapped'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded px-2.5 py-1 text-xs capitalize transition-colors ${
                filter === f ? 'bg-navy-700 text-white' : 'text-ink-muted hover:bg-surface-muted'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null}
          onClick={() => send({ action: 'approve-all' }, 'approve-all')}
        >
          {busy === 'approve-all' ? 'Approving…' : 'Approve all suggestions'}
        </Button>
      </div>

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Account</TH>
              <TH>QuickBooks type</TH>
              <TH className="text-right">This month</TH>
              <TH>Management category</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {filtered.map((r) => (
              <TR key={r.accountQboId} className={!r.isActive ? 'opacity-60' : ''}>
                <TD>
                  <div className="font-medium">{r.accountName}</div>
                  <div className="text-[11px] text-ink-subtle">
                    {r.accountNumber ? `#${r.accountNumber} · ` : ''}ID {r.accountQboId}
                    {!r.isActive ? ' · inactive' : ''}
                  </div>
                </TD>
                <TD className="text-xs text-ink-muted">
                  {r.accountType}
                  {r.accountSubType ? ` / ${r.accountSubType}` : ''}
                </TD>
                <TD className="text-right tnum">{formatCurrency(r.currentMonthAmount, { currency })}</TD>
                <TD>
                  <Select
                    aria-label={`Category for ${r.accountName}`}
                    value={r.categoryKey ?? ''}
                    disabled={busy === r.accountQboId}
                    onChange={(e) =>
                      e.target.value
                        ? send({ action: 'set', accountQboId: r.accountQboId, categoryKey: e.target.value }, r.accountQboId)
                        : send({ action: 'delete', accountQboId: r.accountQboId }, r.accountQboId)
                    }
                    className="h-8 w-48 text-xs"
                  >
                    <option value="">— unmapped —</option>
                    {categories.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </TD>
                <TD>
                  {!r.categoryKey ? (
                    <Badge variant="outline">Unmapped</Badge>
                  ) : r.approved ? (
                    <Badge variant="positive">Approved</Badge>
                  ) : (
                    <div className="space-y-1">
                      <Badge variant={(r.confidence ?? 0) >= 0.9 ? 'info' : 'warning'}>
                        Suggested {formatPercent(r.confidence)}
                      </Badge>
                      {r.suggestedReason ? (
                        <p className="max-w-[16rem] text-[11px] text-ink-subtle">{r.suggestedReason}</p>
                      ) : null}
                      {(r.confidence ?? 0) < 0.9 ? (
                        <p className="text-[11px] text-warning">Not applied to reports until approved.</p>
                      ) : null}
                    </div>
                  )}
                </TD>
                <TD className="text-right">
                  {r.categoryKey && !r.approved ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === r.accountQboId}
                      onClick={() => send({ action: 'approve', accountQboId: r.accountQboId }, r.accountQboId)}
                    >
                      {busy === r.accountQboId ? 'Saving…' : 'Approve'}
                    </Button>
                  ) : null}
                </TD>
              </TR>
            ))}
            {filtered.length === 0 ? (
              <TR>
                <TD colSpan={6} className="py-6 text-center text-sm text-ink-muted">
                  No accounts match this filter.
                </TD>
              </TR>
            ) : null}
          </TBody>
        </Table>
      </TableWrap>
    </div>
  );
}
