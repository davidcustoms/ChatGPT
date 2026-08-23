'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNotice, LoadingRows } from '@/components/ui/states';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/util/format';

interface ProvenanceResponse {
  metric: {
    key: string;
    label: string;
    value: number | null;
    kind: string;
    formula: string;
    note: string;
  };
  summary: string;
  period: { start: string; end: string; label: string };
  basis: { method: string; label: string };
  source: {
    report: string | null;
    system: string;
    snapshotId: string | null;
    snapshotFetchedAt: string | null;
  };
  derivedFrom: string[];
  categories: string[];
  accountTypes: string[];
  dimensionFilter: string | null;
  accounts: Array<{
    qboId: string;
    name: string;
    accountNumber: string | null;
    accountType: string | null;
    categoryKey: string | null;
    amount: number;
  }>;
  transactions: Array<{
    qboId: string;
    type: string;
    date: string;
    docNumber: string | null;
    entity: string | null;
    account: string | null;
    amount: number;
  }>;
  reconciliationNote: string | null;
}

/**
 * "How was this calculated?"
 *
 * Loads a metric's full derivation on demand: formula, source report and
 * snapshot, contributing accounts with QuickBooks ids, and the underlying
 * transactions where the figure decomposes to postings. This is what makes a
 * dashboard number auditable by the owner's accountant without a developer.
 */
export function MetricProvenance({
  companyId,
  period,
  metricKey,
  currency = 'USD',
  label = 'How was this calculated?',
  className,
}: {
  companyId: string;
  period: string;
  metricKey: string;
  currency?: string;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; data: ProvenanceResponse }
  >({ status: 'idle' });
  const panelId = React.useId();

  async function load() {
    if (state.status === 'ready') return;
    setState({ status: 'loading' });
    try {
      const res = await fetch(
        `/api/provenance?company=${encodeURIComponent(companyId)}&period=${encodeURIComponent(period)}&metric=${encodeURIComponent(metricKey)}`,
      );
      const json = (await res.json()) as ProvenanceResponse & { error?: { message?: string } };
      if (!res.ok) {
        setState({ status: 'error', message: json.error?.message ?? 'Could not load the calculation.' });
        return;
      }
      setState({ status: 'ready', data: json });
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : 'Network error.' });
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) void load();
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="text-[11px] font-medium text-navy-700 underline-offset-2 hover:underline"
      >
        {open ? 'Hide calculation' : label}
      </button>

      <div id={panelId} hidden={!open} className="mt-2">
        {state.status === 'loading' ? <LoadingRows rows={3} /> : null}
        {state.status === 'error' ? <ErrorNotice message={state.message} /> : null}
        {state.status === 'ready' ? <ProvenanceDetail data={state.data} currency={currency} /> : null}
      </div>
    </div>
  );
}

function ProvenanceDetail({ data, currency }: { data: ProvenanceResponse; currency: string }) {
  const money = (v: number | null) => formatCurrency(v, { currency });

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface-muted/50 p-4 text-xs">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <Row label="Figure">
          <span className="tnum font-semibold text-navy-800">
            {data.metric.label}: {money(data.metric.value)}
          </span>
        </Row>
        <Row label="Calculation">{data.metric.formula}</Row>
        <Row label="Reporting period">
          {formatDate(data.period.start)} – {formatDate(data.period.end)}
        </Row>
        <Row label="Basis">
          <Badge variant="navy">{data.basis.label}</Badge>
        </Row>
        <Row label="Source report">{data.source.report ?? 'stored monthly metrics'}</Row>
        <Row label="Source system">{data.source.system}</Row>
        {data.source.snapshotId ? (
          <Row label="Snapshot">
            <span className="font-mono text-[10px]">{data.source.snapshotId.slice(0, 8)}</span>
            {data.source.snapshotFetchedAt
              ? ` · read ${formatDateTime(data.source.snapshotFetchedAt)}`
              : ''}
          </Row>
        ) : null}
        {data.dimensionFilter ? <Row label="Location / class filter">{data.dimensionFilter}</Row> : null}
        {data.derivedFrom.length > 0 ? (
          <Row label="Derived from">{data.derivedFrom.join(', ')}</Row>
        ) : null}
        {data.accountTypes.length > 0 ? (
          <Row label="QuickBooks account types">{data.accountTypes.join(', ')}</Row>
        ) : null}
      </dl>

      <p className="mt-3 border-t border-border pt-2 text-ink-muted">{data.metric.note}</p>
      {data.reconciliationNote ? (
        <p className="mt-1 text-ink-muted">{data.reconciliationNote}</p>
      ) : null}

      {data.accounts.length > 0 ? (
        <div className="mt-3">
          <h4 className="mb-1 font-semibold text-navy-800">Contributing accounts</h4>
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Account</TH>
                  <TH>QuickBooks ID</TH>
                  <TH>Type</TH>
                  <TH className="text-right">Amount</TH>
                </TR>
              </THead>
              <TBody>
                {data.accounts.map((a) => (
                  <TR key={a.qboId}>
                    <TD>
                      {a.name}
                      {a.accountNumber ? (
                        <span className="text-ink-subtle"> · #{a.accountNumber}</span>
                      ) : null}
                    </TD>
                    <TD className="font-mono text-[10px] text-ink-subtle">{a.qboId}</TD>
                    <TD className="text-ink-muted">{a.accountType ?? '—'}</TD>
                    <TD className="text-right tnum">{money(a.amount)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </div>
      ) : null}

      {data.transactions.length > 0 ? (
        <div className="mt-3">
          <h4 className="mb-1 font-semibold text-navy-800">
            Underlying transactions ({data.transactions.length})
          </h4>
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Type</TH>
                  <TH>Payee</TH>
                  <TH>Account</TH>
                  <TH className="text-right">Amount</TH>
                  <TH>QuickBooks ID</TH>
                </TR>
              </THead>
              <TBody>
                {data.transactions.slice(0, 25).map((t, i) => (
                  <TR key={`${t.qboId}-${i}`}>
                    <TD className="whitespace-nowrap">{formatDate(t.date)}</TD>
                    <TD>{t.type}</TD>
                    <TD className="max-w-[12rem] truncate">{t.entity ?? '—'}</TD>
                    <TD className="max-w-[10rem] truncate text-ink-muted">{t.account ?? '—'}</TD>
                    <TD className="text-right tnum">{money(t.amount)}</TD>
                    <TD className="font-mono text-[10px] text-ink-subtle">{t.qboId}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

export { Button };
