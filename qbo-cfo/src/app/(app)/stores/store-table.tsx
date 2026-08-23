'use client';

import * as React from 'react';
import { Delta } from '@/components/ui/metric';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatCurrency, formatPercent } from '@/lib/util/format';

export interface StoreRow {
  store: string;
  rank: number;
  revenue: number;
  momPct: number | null;
  yoyPct: number | null;
  grossProfit: number;
  grossMargin: number | null;
  payroll: number;
  payrollPct: number | null;
  operatingExpenses: number;
  contributionProfit: number;
  contributionMargin: number | null;
}

type SortKey = keyof Omit<StoreRow, 'store'> | 'store';

const COLUMNS: Array<{ key: SortKey; label: string; numeric: boolean }> = [
  { key: 'rank', label: 'Rank', numeric: true },
  { key: 'store', label: 'Store', numeric: false },
  { key: 'revenue', label: 'Revenue', numeric: true },
  { key: 'momPct', label: 'MoM %', numeric: true },
  { key: 'yoyPct', label: 'YoY %', numeric: true },
  { key: 'grossProfit', label: 'Gross profit', numeric: true },
  { key: 'grossMargin', label: 'Gross margin', numeric: true },
  { key: 'payroll', label: 'Payroll', numeric: true },
  { key: 'payrollPct', label: 'Payroll %', numeric: true },
  { key: 'operatingExpenses', label: 'Operating expenses', numeric: true },
  { key: 'contributionProfit', label: 'Contribution profit', numeric: true },
  { key: 'contributionMargin', label: 'Contribution %', numeric: true },
];

/** Sortable store table. Sorting is client-side over an already-computed set. */
export function StoreTable({ rows, currency }: { rows: StoreRow[]; currency: string }) {
  const [sort, setSort] = React.useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'rank',
    dir: 'asc',
  });

  const sorted = React.useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === 'string' || typeof bv === 'string') {
        return sort.dir === 'asc'
          ? String(av).localeCompare(String(bv))
          : String(bv).localeCompare(String(av));
      }
      const an = av ?? Number.NEGATIVE_INFINITY;
      const bn = bv ?? Number.NEGATIVE_INFINITY;
      return sort.dir === 'asc' ? an - bn : bn - an;
    });
    return copy;
  }, [rows, sort]);

  const toggle = (key: SortKey) =>
    setSort((prev) => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));

  const money = (v: number) => formatCurrency(v, { currency });

  return (
    <TableWrap>
      <Table>
        <THead>
          <TR>
            {COLUMNS.map((c) => (
              <TH
                key={String(c.key)}
                className={c.numeric ? 'text-right' : ''}
                aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                <button
                  type="button"
                  onClick={() => toggle(c.key)}
                  className="uppercase tracking-wide hover:text-navy-700"
                >
                  {c.label}
                  {sort.key === c.key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                </button>
              </TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {sorted.map((s) => (
            <TR key={s.store}>
              <TD className="text-right tnum text-ink-muted">{s.rank}</TD>
              <TD className="font-medium">{s.store}</TD>
              <TD className="text-right tnum">{money(s.revenue)}</TD>
              <TD className="text-right"><Delta value={s.momPct} /></TD>
              <TD className="text-right"><Delta value={s.yoyPct} /></TD>
              <TD className="text-right tnum">{money(s.grossProfit)}</TD>
              <TD className="text-right tnum">{formatPercent(s.grossMargin)}</TD>
              <TD className="text-right tnum">{money(s.payroll)}</TD>
              <TD className="text-right tnum">{formatPercent(s.payrollPct)}</TD>
              <TD className="text-right tnum">{money(s.operatingExpenses)}</TD>
              <TD className="text-right tnum font-medium">{money(s.contributionProfit)}</TD>
              <TD className="text-right tnum">{formatPercent(s.contributionMargin)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </TableWrap>
  );
}
