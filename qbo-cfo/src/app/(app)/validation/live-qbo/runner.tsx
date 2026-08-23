'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import type { CheckStatus, ValidationRun } from '@/lib/validation/types';

const STATUS_STYLE: Record<CheckStatus, { label: string; variant: 'positive' | 'negative' | 'warning' | 'default' }> = {
  PASS: { label: 'PASS', variant: 'positive' },
  FAIL: { label: 'FAIL', variant: 'negative' },
  NEEDS_REVIEW: { label: 'NEEDS REVIEW', variant: 'warning' },
  NOT_AVAILABLE: { label: 'NOT AVAILABLE', variant: 'default' },
};

function StatusBadge({ status }: { status: CheckStatus }) {
  const style = STATUS_STYLE[status];
  return <Badge variant={style.variant}>{style.label}</Badge>;
}

export function LiveValidationRunner({
  companyId,
  periods,
  defaultPeriod,
  initialRun,
}: {
  companyId: string;
  periods: Array<{ value: string; label: string }>;
  defaultPeriod: string;
  initialRun: ValidationRun | null;
}) {
  const [run, setRun] = useState<ValidationRun | null>(initialRun);
  const [period, setPeriod] = useState(defaultPeriod);
  const [months, setMonths] = useState(14);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch('/api/validation/live-qbo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, period, historyMonths: months }),
      });
      const body = (await response.json()) as ValidationRun & { error?: { message: string } };
      if (!response.ok) {
        setError(body.error?.message ?? 'The validation run failed.');
        return;
      }
      setRun(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The validation run could not be started.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Run the validation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-ink-muted">
            Imports the selected month and the history before it, reconciles every total against QuickBooks&rsquo; own
            subtotals, generates a report, renders both exports, re-syncs to prove the report is not rewritten, and
            reports the production gate. Nothing is ever written to QuickBooks.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
              Validation month
              <select
                className="h-9 rounded-[var(--radius-control)] border border-border bg-surface px-2 text-sm text-ink"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              >
                {periods.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
              Months of history to import
              <select
                className="h-9 rounded-[var(--radius-control)] border border-border bg-surface px-2 text-sm text-ink"
                value={months}
                onChange={(e) => setMonths(Number(e.target.value))}
              >
                {[3, 14, 24, 36].map((m) => (
                  <option key={m} value={m}>
                    {m} months
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={start} disabled={running}>
              {running ? 'Running…' : 'Run live validation'}
            </Button>
          </div>
          {running ? (
            <p className="text-sm text-ink-muted">
              This can take several minutes. It is importing from QuickBooks, generating a report and rendering both
              exports. Leave the tab open.
            </p>
          ) : null}
          {error ? <p className="text-sm text-negative">{error}</p> : null}
        </CardContent>
      </Card>

      {run ? <RunResults run={run} /> : null}
    </div>
  );
}

function RunResults({ run }: { run: ValidationRun }) {
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle>Production Ready: {run.productionReady ? 'YES' : 'NO'}</CardTitle>
            <Badge variant={run.productionReady ? 'positive' : 'negative'}>
              {run.productionReady ? 'All fourteen criteria pass' : `${run.blockers.length} blocker(s)`}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {run.fatal ? <p className="text-sm text-negative">{run.fatal}</p> : null}

          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Company">{run.company.quickbooksName ?? run.company.localName}</Fact>
            <Fact label="Validation month">{run.period?.label ?? '—'}</Fact>
            <Fact label="Reporting basis">
              {run.period ? `${run.period.accountingMethod} Basis` : '—'}
            </Fact>
            <Fact label="As-of date">{run.period?.asOfDate ?? '—'}</Fact>
            <Fact label="Realm">{run.company.realmId ?? '—'}</Fact>
            <Fact label="Environment">{run.environment}</Fact>
            <Fact label="Report confidence">
              {run.confidenceScore === null ? '—' : `${run.confidenceScore}/100`}
            </Fact>
            <Fact label="App version">{run.appVersion}</Fact>
          </dl>

          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Gate criterion</TH>
                  <TH>Status</TH>
                  <TH>Blocker</TH>
                </TR>
              </THead>
              <TBody>
                {run.gate.map((g) => (
                  <TR key={g.key}>
                    <TD>{g.label}</TD>
                    <TD>
                      <StatusBadge status={g.status} />
                    </TD>
                    <TD className="text-xs text-ink-muted">{g.blocker ?? '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </CardContent>
      </Card>

      {run.sections.map((section) => (
        <Card key={section.key}>
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {section.note ? <p className="text-xs text-ink-muted">{section.note}</p> : null}

            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Check</TH>
                    <TH>Status</TH>
                    <TH>Detail</TH>
                  </TR>
                </THead>
                <TBody>
                  {section.checks.map((check) => (
                    <TR key={check.key}>
                      <TD className="whitespace-nowrap">{check.name}</TD>
                      <TD>
                        <StatusBadge status={check.status} />
                      </TD>
                      <TD className="text-xs">
                        {check.detail}
                        {check.remedy ? (
                          <span className="mt-1 block font-medium text-ink">{check.remedy}</span>
                        ) : null}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>

            {(section.tables ?? []).map((table) => (
              <div key={table.title} className="space-y-2">
                <h4 className="text-sm font-semibold text-ink">{table.title}</h4>
                <TableWrap>
                  <Table>
                    <THead>
                      <TR>
                        {table.columns.map((c) => (
                          <TH key={c}>{c}</TH>
                        ))}
                      </TR>
                    </THead>
                    <TBody>
                      {table.rows.map((row, i) => (
                        <TR key={i}>
                          {row.cells.map((cell, j) => (
                            <TD key={j} className={j === 0 ? '' : 'tnum'}>
                              {j === row.cells.length - 1 && row.status ? (
                                <StatusBadge status={row.status} />
                              ) : (
                                cell
                              )}
                            </TD>
                          ))}
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
                {table.caption ? <p className="text-xs text-ink-muted">{table.caption}</p> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="text-sm font-medium text-ink">{children}</dd>
    </div>
  );
}
