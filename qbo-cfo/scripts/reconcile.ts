/**
 * Financial reconciliation runner.
 *
 * Compares the application's reported figures for one month against
 * QuickBooks' own subtotals, read straight from the stored raw snapshot.
 *
 * Usage:
 *   npm run reconcile                                  # latest month, first company
 *   npm run reconcile -- --period 2026-07
 *   npm run reconcile -- --company <uuid> --period 2026-07
 *   npm run reconcile -- --markdown docs/RECONCILIATION.md
 */
import { writeFileSync } from 'node:fs';
import { getPool, queryOne } from '../src/lib/db/pool';
import { latestMetricsPeriod } from '../src/lib/db/repositories/metrics';
import { reconcilePeriod, renderReconcileTable } from '../src/lib/reports/reconcile';
import { monthLabel, monthPeriodOf } from '../src/lib/util/dates';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  let companyId = arg('company');
  if (!companyId) {
    const row = await queryOne<{ id: string }>('SELECT id FROM companies ORDER BY created_at LIMIT 1');
    companyId = row?.id;
  }
  if (!companyId) throw new Error('No company found. Connect QuickBooks or seed the demo company first.');

  const periodArg = arg('period');
  const period = periodArg ? monthPeriodOf(`${periodArg}-01`) : await latestMetricsPeriod(companyId);
  if (!period) throw new Error('No stored periods to reconcile.');

  const result = await reconcilePeriod({ companyId, period });
  const table = renderReconcileTable(result);

  console.log('');
  console.log(`Reconciliation — ${result.companyName} — ${monthLabel(period)}`);
  console.log(`Basis: ${result.accountingMethod}   Source: ${result.sourceSystem}`);
  console.log(`P&L snapshot: ${result.snapshotIds.profitAndLoss ?? 'none'}`);
  console.log(`Balance Sheet snapshot: ${result.snapshotIds.balanceSheet ?? 'none'}`);
  console.log('');
  console.log(table);
  console.log('');
  console.log(
    `Matched ${result.matched} · Differing ${result.differing} · Unavailable ${result.unavailable}`,
  );
  console.log(result.pass ? 'RESULT: PASS — every available total ties to QuickBooks to the cent.' : 'RESULT: FAIL — investigate the differing lines above.');

  const markdown = arg('markdown');
  if (markdown) {
    const doc = [
      `# Financial Reconciliation`,
      '',
      `**Company:** ${result.companyName}`,
      `**Period:** ${monthLabel(period)} (${period.start} to ${period.end})`,
      `**Basis:** ${result.accountingMethod}`,
      `**Source:** ${result.sourceSystem}`,
      `**Generated:** ${result.generatedAt}`,
      `**Profit & Loss snapshot:** \`${result.snapshotIds.profitAndLoss ?? 'none'}\``,
      `**Balance Sheet snapshot:** \`${result.snapshotIds.balanceSheet ?? 'none'}\``,
      '',
      'QuickBooks values are read directly from the stored raw report JSON — QuickBooks\' own',
      'subtotal rows — not through the application\'s classification logic, so agreement is a',
      'genuine check rather than a restatement.',
      '',
      table,
      '',
      `**Matched:** ${result.matched} · **Differing:** ${result.differing} · **Unavailable:** ${result.unavailable}`,
      '',
      result.pass
        ? '**Result: PASS.** Every available total ties to QuickBooks to the cent.'
        : '**Result: FAIL.** Investigate the differing lines above before relying on this month.',
      '',
      ...result.lines.filter((l) => l.note).map((l) => `- **${l.metric}:** ${l.note}`),
    ].join('\n');
    writeFileSync(markdown, `${doc}\n`);
    console.log(`\nWrote ${markdown}`);
  }

  await getPool().end();
  if (!result.pass) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
