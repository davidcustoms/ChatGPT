import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { WarningNotice } from '@/components/ui/states';
import { formatCurrency, formatPercent } from '@/lib/util/format';
import type { MappingCoverageReport } from '@/lib/finance/coverage';

const CONFIDENCE_VARIANT = {
  high: 'positive',
  medium: 'warning',
  low: 'negative',
} as const;

/**
 * Mapping quality.
 *
 * Coverage is measured in dollars rather than account counts, because ten
 * dormant unmapped accounts matter far less than one carrying a third of
 * operating expense. Categories below 95% coverage are called out, and the AI
 * layer is prevented from drawing conclusions about anything below 85%.
 */
export function CoveragePanel({
  coverage,
  currency = 'USD',
  className,
}: {
  coverage: MappingCoverageReport;
  currency?: string;
  className?: string;
}) {
  const money = (v: number) => formatCurrency(v, { currency });
  const weak = coverage.byCategory.filter((c) => c.confidence !== 'high' && c.caveat);

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Mapping quality</CardTitle>
          <Badge variant={coverage.overallCoverage !== null && coverage.overallCoverage >= 0.95 ? 'positive' : 'warning'}>
            {formatPercent(coverage.overallCoverage)} mapped
          </Badge>
        </div>
        <CardDescription>
          Share of income and expense activity, by dollar value, that reached a management category.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Section</TH>
                <TH className="text-right">Mapped</TH>
                <TH className="text-right">Unmapped</TH>
                <TH className="text-right">Accounts unmapped</TH>
                <TH className="text-right">Coverage</TH>
              </TR>
            </THead>
            <TBody>
              {coverage.sections.map((s) => (
                <TR key={s.section}>
                  <TD className="font-medium">{s.label}</TD>
                  <TD className="text-right tnum">{money(s.mappedAmount)}</TD>
                  <TD className="text-right tnum">{money(s.unmappedAmount)}</TD>
                  <TD className="text-right tnum">{s.unmappedAccountCount}</TD>
                  <TD className="text-right">
                    <Badge
                      variant={
                        s.coverage === null ? 'default' : s.coverage >= 0.95 ? 'positive' : s.coverage >= 0.85 ? 'warning' : 'negative'
                      }
                    >
                      {formatPercent(s.coverage)}
                    </Badge>
                  </TD>
                </TR>
              ))}
              <TR className="bg-surface-muted/70 font-semibold">
                <TD>Total unmapped</TD>
                <TD />
                <TD className="text-right tnum">{money(coverage.totalUnmappedAmount)}</TD>
                <TD className="text-right tnum">{coverage.totalUnmappedAccounts}</TD>
                <TD className="text-right tnum">{formatPercent(coverage.overallCoverage)}</TD>
              </TR>
            </TBody>
          </Table>
        </TableWrap>

        {weak.length > 0 ? (
          <WarningNotice className="mt-3">
            <p className="font-semibold">Categories with incomplete mapping</p>
            <ul className="mt-1 space-y-1">
              {weak.slice(0, 8).map((c) => (
                <li key={c.categoryKey} className="flex items-start gap-2">
                  <Badge variant={CONFIDENCE_VARIANT[c.confidence]}>{c.confidence}</Badge>
                  <span>{c.caveat}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2">
              Analysis of categories marked <strong>low</strong> is withheld from the CFO commentary until
              coverage improves.{' '}
              <Link className="underline underline-offset-2" href="/settings/account-mapping">
                Review account mappings
              </Link>
              .
            </p>
          </WarningNotice>
        ) : null}

        {coverage.worstSection && coverage.worstSection.unmappedAccounts.length > 0 ? (
          <div className="mt-3">
            <h4 className="mb-1 text-xs font-semibold text-navy-800">
              Largest unmapped accounts in {coverage.worstSection.label}
            </h4>
            <ul className="space-y-1 text-xs">
              {coverage.worstSection.unmappedAccounts.slice(0, 6).map((a) => (
                <li key={a.qboId} className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-ink">{a.name}</span>
                  <span className="tnum text-ink-muted">{money(Math.abs(a.amount))}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
