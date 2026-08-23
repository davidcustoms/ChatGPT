'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ErrorNotice, LoadingRows } from '@/components/ui/states';
import { formatCurrency, formatDate } from '@/lib/util/format';

interface DrilldownResponse {
  category: { key: string; label: string };
  period: { start: string; end: string };
  total: number;
  accounts: Array<{ qboId: string; name: string; accountType: string | null; amount: number }>;
  transactions: Array<{
    qboId: string;
    type: string;
    date: string;
    docNumber: string | null;
    vendor: string | null;
    memo: string | null;
    account: string | null;
    location: string | null;
    amount: number;
  }>;
  source: string;
}

/**
 * Source traceability: loads the transactions behind a category total so the
 * owner or their accountant can verify the figure against QuickBooks.
 */
export function DrilldownPanel({
  companyId,
  period,
  categoryKey,
  currency,
}: {
  companyId: string;
  period: string;
  categoryKey: string;
  currency: string;
}) {
  const [state, setState] = React.useState<
    { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: DrilldownResponse }
  >({ status: 'idle' });

  async function load() {
    setState({ status: 'loading' });
    try {
      const res = await fetch(
        `/api/drilldown?company=${encodeURIComponent(companyId)}&period=${encodeURIComponent(period)}&category=${encodeURIComponent(categoryKey)}`,
      );
      const json = (await res.json()) as DrilldownResponse & { error?: { message?: string } };
      if (!res.ok) {
        setState({ status: 'error', message: json.error?.message ?? 'Could not load the drill-down.' });
        return;
      }
      setState({ status: 'ready', data: json });
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : 'Network error.' });
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-navy-800">Underlying transactions</h3>
        {state.status !== 'ready' ? (
          <Button size="sm" variant="outline" onClick={load} disabled={state.status === 'loading'}>
            {state.status === 'loading' ? 'Loading…' : 'Show transactions'}
          </Button>
        ) : null}
      </div>

      {state.status === 'loading' ? <LoadingRows rows={4} /> : null}
      {state.status === 'error' ? <ErrorNotice message={state.message} /> : null}
      {state.status === 'ready' ? (
        state.data.transactions.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No stored transactions post to these accounts for this period. Category totals still come from the
            QuickBooks Profit &amp; Loss report.
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-ink-subtle">
              {state.data.transactions.length} transaction line(s) · Source: {state.data.source}
            </p>
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Date</TH>
                    <TH>Type</TH>
                    <TH>Vendor</TH>
                    <TH>Account</TH>
                    <TH>Location</TH>
                    <TH>Doc #</TH>
                    <TH className="text-right">Amount</TH>
                    <TH>QuickBooks ID</TH>
                  </TR>
                </THead>
                <TBody>
                  {state.data.transactions.map((t, i) => (
                    <TR key={`${t.qboId}-${i}`}>
                      <TD className="whitespace-nowrap text-xs">{formatDate(t.date)}</TD>
                      <TD className="text-xs">{t.type}</TD>
                      <TD className="max-w-[14rem] truncate">{t.vendor ?? '—'}</TD>
                      <TD className="max-w-[12rem] truncate text-xs text-ink-muted">{t.account ?? '—'}</TD>
                      <TD className="text-xs text-ink-muted">{t.location ?? '—'}</TD>
                      <TD className="text-xs text-ink-muted">{t.docNumber ?? '—'}</TD>
                      <TD className="text-right tnum">{formatCurrency(t.amount, { currency })}</TD>
                      <TD className="font-mono text-[11px] text-ink-subtle">{t.qboId}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </>
        )
      ) : null}
    </div>
  );
}
