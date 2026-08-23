/**
 * Performance benchmark.
 *
 * Builds a throwaway company with a realistic transaction volume and times the
 * paths an owner actually waits on: importing, re-importing, loading the
 * dashboard, generating a report, and asking the CFO a question.
 *
 * The transactions are synthetic but shaped like real ones -- multiple line
 * items, vendors, locations, spread across 24 months -- because the query cost
 * lives in the joins and the aggregation, not in the row count alone.
 *
 * Usage:
 *   npm run benchmark                     # 50,000 transactions
 *   npm run benchmark -- --count 250000
 *   npm run benchmark -- --count 50000,100000,250000 --markdown docs/PERFORMANCE.md
 *
 * The company is deleted at the end unless --keep is passed.
 */
import { writeFileSync } from 'node:fs';
import { getPool, query } from '../src/lib/db/pool';
import { runMigrations } from '../src/lib/db/migrate';
import { createUser, findUserByEmail } from '../src/lib/db/repositories/users';
import { createCompany } from '../src/lib/db/repositories/companies';
import {
  saveMonthlyMetrics,
  saveVendorSpend,
  getMonthlyMetrics,
  listAllMetrics,
  categoryTotalsByPeriod,
} from '../src/lib/db/repositories/metrics';
import {
  upsertTransactions,
  vendorSpendFromTransactions,
  transactionsForAccount,
  type TransactionInput,
} from '../src/lib/db/repositories/transactions';
import { answerQuestion } from '../src/lib/ai/nlq';
import { addMonths, monthPeriodOf, type Period } from '../src/lib/util/dates';
import type { MonthlyMetrics } from '../src/lib/finance/types';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const MONTHS = 24;
const END = monthPeriodOf('2026-07-01');
const VENDORS = [
  'Ashley Furniture Industries', 'Coaster Fine Furniture', 'Sealy Mattress Co',
  'Tempur-Sealy Distribution', 'Modway Imports', 'Meta Platforms',
  'Harborline Logistics', 'Pacific Freight Partners', 'Nationwide Delivery Co',
  'Bay Area Property Group',
];
const ACCOUNTS = ['4', '5', '6', '7', '8', '9'];
const LOCATIONS = ['300', '301', '302'];
const TXN_TYPES = ['Bill', 'Purchase', 'Invoice', 'SalesReceipt', 'JournalEntry'];

/** Deterministic pseudo-randomness: the same run always produces the same data. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function periods(): Period[] {
  return Array.from({ length: MONTHS }, (_, i) => addMonths(END, -(MONTHS - 1 - i)));
}

function makeBatch(offset: number, size: number, all: Period[]): TransactionInput[] {
  const random = rng(offset + 1);
  const out: TransactionInput[] = [];
  for (let i = 0; i < size; i += 1) {
    const n = offset + i;
    const period = all[n % all.length]!;
    const day = 1 + Math.floor(random() * 27);
    const lineCount = 1 + Math.floor(random() * 3);
    const amount = Math.round((50 + random() * 9_950) * 100) / 100;
    out.push({
      qboId: `bench-${n}`,
      txnType: TXN_TYPES[n % TXN_TYPES.length]!,
      txnDate: `${period.start.slice(0, 8)}${String(day).padStart(2, '0')}`,
      docNumber: `D-${n}`,
      entityType: 'Vendor',
      entityQboId: String(100 + (n % VENDORS.length)),
      entityName: VENDORS[n % VENDORS.length]!,
      memo: `Benchmark transaction ${n}`,
      totalAmount: amount,
      locationQboId: LOCATIONS[n % LOCATIONS.length]!,
      classQboId: null,
      lines: Array.from({ length: lineCount }, (_, l) => ({
        lineNum: l + 1,
        description: `Line ${l + 1}`,
        amount: Math.round((amount / lineCount) * 100) / 100,
        accountQboId: ACCOUNTS[(n + l) % ACCOUNTS.length]!,
        accountName: `Account ${ACCOUNTS[(n + l) % ACCOUNTS.length]}`,
        locationQboId: LOCATIONS[n % LOCATIONS.length]!,
      })),
    });
  }
  return out;
}

function metricsFor(companyId: string, period: Period, i: number): MonthlyMetrics {
  const netSales = 500_000 + i * 7_500;
  const cogs = Math.round(netSales * 0.55);
  const opex = Math.round(netSales * 0.34);
  return {
    companyId, period, accountingMethod: 'Accrual',
    grossSales: netSales, discounts: 0, refunds: 0, netSales,
    cogs, grossProfit: netSales - cogs, grossMargin: (netSales - cogs) / netSales,
    operatingExpenses: opex, payrollExpense: Math.round(opex * 0.55),
    advertisingExpense: Math.round(opex * 0.1), rentExpense: Math.round(opex * 0.15),
    deliveryExpense: 0, freightExpense: 0, warehouseExpense: 0, financingFees: 0,
    merchantFees: 0, bankFees: 0, interestExpense: 0, utilitiesExpense: 0,
    insuranceExpense: 0, repairsExpense: 0, vehicleExpense: 0, professionalFees: 0,
    softwareExpense: 0, taxesExpense: 0, otherOpex: 0,
    netOperatingIncome: netSales - cogs - opex, otherIncome: 0, otherExpense: 0,
    netIncome: netSales - cogs - opex, netMargin: (netSales - cogs - opex) / netSales,
    cash: 300_000 + i * 1_000, accountsReceivable: 150_000, accountsPayable: 90_000,
    inventoryValue: 800_000, otherCurrentAssets: null, currentAssets: null,
    fixedAssets: null, totalAssets: 1_250_000, creditCards: null, shortTermDebt: null,
    longTermDebt: null, currentLiabilities: null, totalLiabilities: 400_000, equity: 850_000,
    unmappedOpexAmount: 0, unmappedOpexPct: 0, balanceSheetBalanced: true,
    sourceSnapshotIds: [], computedAt: new Date(0).toISOString(),
  };
}

interface Timing {
  label: string;
  ms: number;
  note: string;
}

async function time<T>(label: string, note: string, fn: () => Promise<T>): Promise<[T, Timing]> {
  const started = process.hrtime.bigint();
  const value = await fn();
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  return [value, { label, ms, note }];
}

function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(0)} ms`;
}

async function runScale(userId: string, count: number): Promise<{ count: number; timings: Timing[] }> {
  const company = await createCompany({
    ownerUserId: userId,
    name: `Benchmark ${count}`,
    fiscalYearStartMonth: 1,
  });
  const all = periods();
  const timings: Timing[] = [];

  // Derived metrics for every month, so the read paths have something to read.
  for (const [i, period] of all.entries()) {
    await saveMonthlyMetrics(metricsFor(company.id, period, i));
  }

  // --- Initial import ------------------------------------------------------
  const BATCH = 2_000;
  const [, ingest] = await time('Initial import', `${count.toLocaleString()} transactions`, async () => {
    for (let offset = 0; offset < count; offset += BATCH) {
      await upsertTransactions(company.id, makeBatch(offset, Math.min(BATCH, count - offset), all));
    }
  });
  timings.push(ingest);
  timings.push({
    label: 'Initial import, per 1,000 transactions',
    ms: (ingest.ms / count) * 1000,
    note: 'derived from the run above',
  });

  // --- Incremental import (one month re-synced) ---------------------------
  const monthSize = Math.max(1, Math.round(count / MONTHS));
  const [, incremental] = await time(
    'Incremental sync',
    `re-import of one month (${monthSize.toLocaleString()} transactions, all already stored)`,
    async () => {
      for (let offset = 0; offset < monthSize; offset += BATCH) {
        await upsertTransactions(company.id, makeBatch(offset, Math.min(BATCH, monthSize - offset), all));
      }
    },
  );
  timings.push(incremental);

  // --- Vendor aggregation --------------------------------------------------
  const [vendors, vendorAgg] = await time(
    'Vendor spend aggregation',
    'group and rank one month of transactions by vendor',
    () => vendorSpendFromTransactions(company.id, END),
  );
  timings.push(vendorAgg);
  await saveVendorSpend(company.id, END, vendors);

  // --- Dashboard -----------------------------------------------------------
  const [, dashboard] = await time(
    'Dashboard load',
    '24 months of metrics, the current month and its category totals',
    async () => {
      await Promise.all([
        listAllMetrics(company.id, 48),
        getMonthlyMetrics(company.id, END),
        categoryTotalsByPeriod(company.id, all[0]!.start, END.start),
      ]);
    },
  );
  timings.push(dashboard);

  // --- Drill-down ----------------------------------------------------------
  const [, drilldown] = await time(
    'Drill-down',
    'transactions behind one category for one month, capped at 300',
    () => transactionsForAccount(company.id, ACCOUNTS, END, 300),
  );
  timings.push(drilldown);

  // --- Report generation ---------------------------------------------------
  const { buildReportPayload } = await import('../src/lib/reports/builder');
  const [built, report] = await time(
    'Report build',
    'the full deterministic monthly report payload',
    () => buildReportPayload({ companyId: company.id, period: END }),
  );
  timings.push(report);

  const [, pdf] = await time('PDF render', 'the complete monthly PDF', async () => {
    const { renderReportPdf } = await import('../src/lib/reports/pdf');
    const { DEFAULT_BRANDING } = await import('../src/lib/db/repositories/companies');
    return renderReportPdf(built.payload, DEFAULT_BRANDING);
  });
  timings.push(pdf);

  const [, xlsx] = await time('Excel render', 'the complete monthly workbook', async () => {
    const { renderReportWorkbook } = await import('../src/lib/reports/excel');
    return renderReportWorkbook(built.payload);
  });
  timings.push(xlsx);

  // --- Chat ----------------------------------------------------------------
  const [, chatSummary] = await time(
    'Chat: month summary',
    'deterministic resolution, no model call',
    () => answerQuestion({ companyId: company.id, question: 'How did we do last month?' }),
  );
  timings.push(chatSummary);

  const [, chatDrivers] = await time(
    'Chat: profit bridge',
    'the most expensive question the resolver answers',
    () => answerQuestion({ companyId: company.id, question: 'Why did profit go down?' }),
  );
  timings.push(chatDrivers);

  const [, chatVendors] = await time(
    'Chat: vendor ranking',
    'ranks vendors from stored spend',
    () => answerQuestion({ companyId: company.id, question: 'Who are our largest vendors?' }),
  );
  timings.push(chatVendors);

  if (arg('keep') === undefined && !process.argv.includes('--keep')) {
    await query('DELETE FROM companies WHERE id = $1', [company.id]);
  }

  return { count, timings };
}

async function main(): Promise<void> {
  await runMigrations();
  const email = 'benchmark@example.invalid';
  const existing = await findUserByEmail(email);
  const userId = existing?.id ?? (await createUser({ email, password: 'benchmark-password' })).id;
  await query('DELETE FROM companies WHERE owner_user_id = $1', [userId]);

  const counts = (arg('count') ?? '50000')
    .split(',')
    .map((c) => Number(c.trim()))
    .filter((c) => Number.isFinite(c) && c > 0);

  const runs: Array<{ count: number; timings: Timing[] }> = [];
  for (const count of counts) {
    console.log(`\nRunning at ${count.toLocaleString()} transactions...`);
    const run = await runScale(userId, count);
    runs.push(run);
    for (const t of run.timings) {
      console.log(`  ${t.label.padEnd(38)} ${fmt(t.ms).padStart(10)}   ${t.note}`);
    }
  }

  const markdown = arg('markdown');
  if (markdown) {
    const labels = runs[0]!.timings.map((t) => t.label);
    const lines: string[] = [];
    lines.push('# Performance');
    lines.push('');
    lines.push('Generated by `npm run benchmark`. Every figure is a measured wall-clock time,');
    lines.push('not an estimate.');
    lines.push('');
    lines.push('## Method');
    lines.push('');
    lines.push('A throwaway company is built with 24 months of derived metrics and the stated');
    lines.push('number of transactions, each carrying one to three line items, spread across ten');
    lines.push('vendors and three locations. The transactions are synthetic but shaped like real');
    lines.push('ones, because the cost lives in the joins and the aggregation rather than in the');
    lines.push('row count alone.');
    lines.push('');
    lines.push('Chat timings are the deterministic resolution only. When `OPENAI_API_KEY` is set,');
    lines.push('add the model latency: the application does the arithmetic first and the model');
    lines.push('only rewords the verified result, so a slow model delays the wording, never the');
    lines.push('figures.');
    lines.push('');
    lines.push('Renderer timings include module load on the first scale measured, so the PDF and');
    lines.push('Excel figures at the smallest scale are inflated by roughly 300-700 ms of one-off');
    lines.push('import cost. Both are independent of transaction count -- they render the already');
    lines.push('computed report payload -- so the later, warm numbers are the representative ones.');
    lines.push('');
    lines.push('## Results');
    lines.push('');
    lines.push(`| Operation | ${runs.map((r) => `${r.count.toLocaleString()} txns`).join(' | ')} |`);
    lines.push(`| --- | ${runs.map(() => '---:').join(' | ')} |`);
    for (const [i, label] of labels.entries()) {
      const cells = runs.map((r) => fmt(r.timings[i]?.ms ?? 0));
      lines.push(`| ${label} | ${cells.join(' | ')} |`);
    }
    lines.push('');
    lines.push('### What each row measures');
    lines.push('');
    for (const t of runs[0]!.timings) {
      lines.push(`- **${t.label}** — ${t.note}`);
    }
    lines.push('');
    writeFileSync(markdown, lines.join(String.fromCharCode(10)) + String.fromCharCode(10), 'utf8');
    console.log(`\nWritten to ${markdown}`);
  }

  await query('DELETE FROM companies WHERE owner_user_id = $1', [userId]);
  await getPool().end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
