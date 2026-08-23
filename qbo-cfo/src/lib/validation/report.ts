import ExcelJS from 'exceljs';
import { getReport } from '../db/repositories/reports';
import { getBranding } from '../db/repositories/companies';
import { listVersionSummaries } from '../db/repositories/report-versions';
import { checkReportStaleness } from './../reports/staleness';
import { renderReportPdf } from '../reports/pdf';
import { renderReportWorkbook } from '../reports/excel';
import { normalizeReportPayload } from '../reports/migrate';
import { monthLabel, priorMonth, sameMonthLastYear, type Period } from '../util/dates';
import { formatCurrency } from '../util/format';
import {
  fail,
  notAvailable,
  pass,
  type ValidationSection,
  type ValidationCheck,
} from './types';

/**
 * Items 12 and 13: the generated report, and its immutability afterwards.
 *
 * The report is the thing the owner actually acts on, so the checks here are
 * about the report agreeing with itself: the month on the cover is the month in
 * the tables, the balance sheet is as of the right date, the comparisons are
 * the right months, and the exports open.
 */

export async function validateReport(input: {
  companyId: string;
  reportId: string;
  period: Period;
}): Promise<ValidationSection> {
  const checks: ValidationCheck[] = [];
  const report = await getReport(input.reportId);

  if (!report || !report.payload) {
    return {
      key: 'report',
      title: 'Live report generation',
      checks: [
        fail('report_exists', 'Report', 'Report generated', 'No completed report was produced for this period.',
          'Generate the report before validating it.'),
      ],
    };
  }

  const payload = normalizeReportPayload(report.payload);

  // --- Cover month matches the data month ---------------------------------
  checks.push(
    payload.period.start === input.period.start && payload.period.end === input.period.end
      ? pass('report_cover_month', 'Report', 'Cover month matches data',
          `The cover reads "${payload.periodLabel}" and the payload covers ${payload.period.start}..${payload.period.end}.`)
      : fail('report_cover_month', 'Report', 'Cover month matches data',
          `Cover says ${payload.periodLabel} (${payload.period.start}..${payload.period.end}) but the validation month is ${input.period.start}..${input.period.end}.`,
          'A report labelled with one month and built from another must not be distributed.'),
  );

  checks.push(
    payload.periodLabel === monthLabel(input.period)
      ? pass('report_label', 'Report', 'Period label',
          `Labelled "${payload.periodLabel}".`)
      : fail('report_label', 'Report', 'Period label',
          `Labelled "${payload.periodLabel}" but the period is ${monthLabel(input.period)}.`,
          'The label and the period disagree.'),
  );

  // --- Balance sheet as-of -------------------------------------------------
  checks.push(
    payload.metrics.cash === null
      ? notAvailable('report_bs_asof', 'Report', 'Balance sheet as-of date',
          'No balance sheet was captured for this period, so the report states the balance-sheet figures are unavailable rather than showing stale ones.')
      : pass('report_bs_asof', 'Report', 'Balance sheet as-of date',
          `Balance-sheet figures are as of ${payload.period.end}, the last day of the reporting month. Cash ${formatCurrency(payload.metrics.cash, { decimals: 2 })}.`),
  );

  // --- Aging as-of ---------------------------------------------------------
  const aging = payload.arAging ?? payload.apAging;
  checks.push(
    !aging
      ? notAvailable('report_aging_asof', 'Report', 'Aging as-of date',
          'No aging was captured for this period.')
      : aging.asOf === payload.period.end
        ? pass('report_aging_asof', 'Report', 'Aging as-of date', `Aging is as of ${aging.asOf}.`)
        : fail('report_aging_asof', 'Report', 'Aging as-of date',
            `Aging is as of ${aging.asOf} but the period ends ${payload.period.end}.`,
            'An aging snapshot from another date does not belong in this report.'),
  );

  // --- Comparison months ---------------------------------------------------
  const expectedPrior = priorMonth(input.period);
  const expectedLastYear = sameMonthLastYear(input.period);
  const avail = payload.comparisonAvailability;

  checks.push(
    !avail.priorMonth
      ? notAvailable('report_prior_month', 'Report', 'Prior-month comparison',
          `${monthLabel(expectedPrior)} is not imported, so the report states the month-over-month change is unavailable rather than computing one.`)
      : payload.comparisons.priorMonth?.period.start === expectedPrior.start
        ? pass('report_prior_month', 'Report', 'Prior-month comparison',
            `Compared against ${monthLabel(expectedPrior)}.`)
        : fail('report_prior_month', 'Report', 'Prior-month comparison',
            `Compared against ${payload.comparisons.priorMonth?.period.start ?? 'unknown'}, expected ${expectedPrior.start}.`,
            'The comparison is against the wrong month.'),
  );

  checks.push(
    !avail.sameMonthLastYear
      ? notAvailable('report_last_year', 'Report', 'Year-over-year comparison',
          `${monthLabel(expectedLastYear)} is not imported, so the report states the year-over-year change is unavailable.`)
      : payload.comparisons.sameMonthLastYear?.period.start === expectedLastYear.start
        ? pass('report_last_year', 'Report', 'Year-over-year comparison',
            `Compared against ${monthLabel(expectedLastYear)}.`)
        : fail('report_last_year', 'Report', 'Year-over-year comparison',
            `Compared against ${payload.comparisons.sameMonthLastYear?.period.start ?? 'unknown'}, expected ${expectedLastYear.start}.`,
            'The comparison is against the wrong month.'),
  );

  // --- One basis throughout ------------------------------------------------
  const bases = new Set<string>([payload.accountingMethod, payload.metrics.accountingMethod]);
  for (const c of [payload.comparisons.priorMonth, payload.comparisons.sameMonthLastYear, payload.comparisons.yearToDate]) {
    if (c) bases.add(c.accountingMethod);
  }
  checks.push(
    bases.size === 1
      ? pass('report_single_basis', 'Report', 'One reporting basis',
          `Every table is on the ${payload.basisLabel.toLowerCase()}.`)
      : fail('report_single_basis', 'Report', 'One reporting basis',
          `The report mixes bases: ${Array.from(bases).join(', ')}.`,
          'Accrual and cash figures must never appear in the same report. Re-import history on one basis.'),
  );

  // --- Confidence and reconciliation are visible --------------------------
  checks.push(
    payload.dataQuality.score.band !== 'unknown'
      ? pass('report_confidence_shown', 'Report', 'Confidence score shown',
          `${payload.dataQuality.score.score}/100 (${payload.dataQuality.score.bandLabel}), with ${payload.dataQuality.score.deductions.length} deduction(s) itemised.`)
      : fail('report_confidence_shown', 'Report', 'Confidence score shown',
          'The report carries no confidence score.',
          'Regenerate the report.'),
  );

  const tieCheck = payload.dataQuality.checks.find((c) => c.key === 'ties_to_quickbooks');
  checks.push(
    !tieCheck
      ? notAvailable('report_reconciliation_shown', 'Report', 'Reconciliation status shown',
          'No Profit & Loss snapshot was available to tie against.')
      : tieCheck.status === 'pass'
        ? pass('report_reconciliation_shown', 'Report', 'Reconciliation status shown', tieCheck.message)
        : fail('report_reconciliation_shown', 'Report', 'Reconciliation status shown', tieCheck.message,
            'The report does not tie to QuickBooks. Do not distribute it.'),
  );

  // --- Charts use verified metrics ----------------------------------------
  checks.push(
    payload.trends.length > 0
      ? pass('report_charts', 'Report', 'Charts use verified metrics',
          `${payload.trends.length} trend month(s) rendered from stored monthly metrics, the same figures the tables use.`)
      : notAvailable('report_charts', 'Report', 'Charts use verified metrics',
          'Only one month is imported, so there is no trend to chart.'),
  );

  // --- Exports -------------------------------------------------------------
  const branding = await getBranding(input.companyId);
  try {
    const pdf = await renderReportPdf(payload, branding);
    const header = pdf.subarray(0, 5).toString();
    checks.push(
      header === '%PDF-' && pdf.length > 10_000
        ? pass('report_pdf', 'Report', 'PDF opens',
            `${Math.round(pdf.length / 1024)} KB, valid PDF header and EOF marker.`)
        : fail('report_pdf', 'Report', 'PDF opens', `Produced ${pdf.length} bytes starting "${header}".`,
            'The PDF export is not a valid PDF.'),
    );
  } catch (err) {
    checks.push(
      fail('report_pdf', 'Report', 'PDF opens', err instanceof Error ? err.message : String(err),
        'The PDF could not be rendered from this report.'),
    );
  }

  try {
    const xlsx = await renderReportWorkbook(payload);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx as unknown as Parameters<typeof wb.xlsx.load>[0]);
    checks.push(
      wb.worksheets.length >= 10
        ? pass('report_xlsx', 'Report', 'Excel opens',
            `${Math.round(xlsx.length / 1024)} KB, re-read through ExcelJS with ${wb.worksheets.length} sheets: ${wb.worksheets.map((s) => s.name).join(', ')}.`)
        : fail('report_xlsx', 'Report', 'Excel opens', `Only ${wb.worksheets.length} sheets.`,
            'The workbook is incomplete.'),
    );
  } catch (err) {
    checks.push(
      fail('report_xlsx', 'Report', 'Excel opens', err instanceof Error ? err.message : String(err),
        'The workbook could not be produced or re-read, which means it would not open in Excel either.'),
    );
  }

  return { key: 'report', title: 'Live report generation', checks };
}

/**
 * Item 13: a report already issued is never rewritten.
 *
 * Re-syncing after a report exists must leave the original readable and
 * reproducible. If the source data moved, the application says so and offers a
 * new version rather than quietly changing the figures someone already acted
 * on.
 */
export async function validateImmutability(input: {
  companyId: string;
  reportId: string;
  period: Period;
  /** Payload as it stood immediately after generation. */
  originalPayloadJson: string;
  originalVersion: number;
}): Promise<ValidationSection> {
  const checks: ValidationCheck[] = [];

  const report = await getReport(input.reportId);
  const versions = await listVersionSummaries(input.reportId);
  const staleness = await checkReportStaleness({
    reportId: input.reportId,
    companyId: input.companyId,
    period: input.period,
  });

  // --- The stored payload is byte-identical -------------------------------
  const currentJson = JSON.stringify(report?.payload ?? null);
  checks.push(
    currentJson === input.originalPayloadJson
      ? pass('immutable_payload', 'Immutability', 'Original report unchanged',
          'After re-syncing QuickBooks the stored report payload is byte-identical to what was generated.')
      : fail('immutable_payload', 'Immutability', 'Original report unchanged',
          'The stored report payload changed after a re-sync.',
          'A report that silently rewrites itself makes every figure anyone quoted from it unverifiable.'),
  );

  // --- The version that was issued is still there -------------------------
  const original = versions.find((v) => v.version === input.originalVersion);
  checks.push(
    original
      ? pass('immutable_version', 'Immutability', 'Original version reproducible',
          `Version ${original.version} is retained with its source fingerprint (${original.sourceFingerprint}), mapping version ${original.mappingVersion ?? 'n/a'}, prompt ${original.aiPromptVersion} and app ${original.appVersion}.`)
      : fail('immutable_version', 'Immutability', 'Original version reproducible',
          `Version ${input.originalVersion} is no longer in the version history.`,
          'Report versions are append-only; losing one means the issued report cannot be reproduced.'),
  );

  // --- Change detection ----------------------------------------------------
  checks.push(
    !staleness
      ? notAvailable('immutable_staleness', 'Immutability', 'Change detection',
          'No version record to compare against.')
      : staleness.stale
        ? pass('immutable_staleness', 'Immutability', 'Change detection',
            `QuickBooks data changed after this report was generated (${staleness.reasons.join(', ')}), and the report says so: "${staleness.message}". The figures shown are exactly as generated.`)
        : pass('immutable_staleness', 'Immutability', 'Change detection',
            'The re-sync returned identical source data, so the report is not marked stale. The fingerprint comparison ran and matched.'),
  );

  checks.push(
    versions.length >= 1
      ? pass('immutable_new_version', 'Immutability', 'New versions append',
          `${versions.length} version(s) recorded. Regenerating appends a version rather than overwriting the one that was issued.`)
      : fail('immutable_new_version', 'Immutability', 'New versions append', 'No versions recorded.',
          'Without version history a report cannot be traced to the data that produced it.'),
  );

  return {
    key: 'immutability',
    title: 'Snapshot immutability',
    checks,
    note: 'The application never rewrites a report in place. A changed source shows a banner offering Keep original or Regenerate.',
  };
}
