import { describe, expect, it } from 'vitest';
import { normalizeReportPayload } from '@/lib/reports/migrate';
import { renderReportWorkbook } from '@/lib/reports/excel';
import { renderReportPdf } from '@/lib/reports/pdf';
import { DEFAULT_BRANDING } from '@/lib/db/repositories/companies';
import { reportPayload } from './fixtures/report';

/**
 * Stored report payloads outlive the code that wrote them.
 *
 * A generated report is a historical record: the figures in it are what the
 * business was told, and they must stay readable after the application has
 * moved on. Before this normaliser, a report stored before the data-quality
 * score existed made its own page, its PDF and its workbook all return 500 --
 * the report became unopenable the moment the application was upgraded.
 */

/** A payload as it was written before the production-hardening work. */
function legacyPayload(): Record<string, unknown> {
  const current = reportPayload() as unknown as Record<string, unknown>;
  const legacy = { ...current };
  delete legacy['mappingCoverage'];
  delete legacy['provenance'];
  delete legacy['provenanceVersion'];
  delete legacy['comparisonAvailability'];
  delete legacy['accountingMethod'];
  delete legacy['basisLabel'];
  delete legacy['basisDescription'];
  // The old shape had a confidence and reasons, but no score.
  legacy['dataQuality'] = { checks: [], confidence: 'medium', reasons: ['Two months of history'] };
  return legacy;
}

describe('legacy report payloads', () => {
  it('fills in every field the renderers require', () => {
    const payload = normalizeReportPayload(legacyPayload());

    expect(payload.dataQuality.score).toBeDefined();
    expect(payload.mappingCoverage).toBeDefined();
    expect(payload.provenance).toEqual({});
    expect(payload.comparisonAvailability).toBeDefined();
    expect(payload.accountingMethod).toBe('Accrual');
    expect(payload.basisLabel).toBe('Accrual Basis');
  });

  it('marks an unrecorded score as not scored rather than as a bad score', () => {
    const payload = normalizeReportPayload(legacyPayload());

    // A backfilled 0/100 would read as a damning verdict on the bookkeeping.
    expect(payload.dataQuality.score.band).toBe('unknown');
    expect(payload.dataQuality.score.bandLabel).toBe('Not scored');
    expect(payload.dataQuality.score.deductions[0]?.reason).toMatch(/Not recorded for this report version/);
    // The confidence the report was actually stored with is preserved.
    expect(payload.dataQuality.confidence).toBe('medium');
  });

  it('reports unrecorded coverage as unknown, never as complete', () => {
    const payload = normalizeReportPayload(legacyPayload());

    // null renders as unknown. A backfilled 1 would claim full coverage.
    expect(payload.mappingCoverage.overallCoverage).toBeNull();
    expect(payload.mappingCoverage.byCategory).toEqual([]);
  });

  it('never invents a financial figure', () => {
    const legacy = legacyPayload();
    const payload = normalizeReportPayload(legacy);

    // Every figure that was stored is unchanged.
    expect(payload.metrics).toEqual(legacy['metrics']);
    expect(payload.comparisons).toEqual(legacy['comparisons']);
    expect(payload.observations).toEqual(legacy['observations']);
    expect(payload.dataQuality.score.score).toBe(0);
  });

  it('derives comparison availability from the comparisons actually stored', () => {
    const payload = normalizeReportPayload(legacyPayload());

    // The fixture has a prior month and nothing else.
    expect(payload.comparisonAvailability.priorMonth).toBe(true);
    expect(payload.comparisonAvailability.sameMonthLastYear).toBe(false);
    expect(payload.comparisonAvailability.yearToDate).toBe(false);
  });

  it('leaves a current payload untouched', () => {
    const current = reportPayload();
    const normalized = normalizeReportPayload(current);

    expect(normalized.dataQuality.score.band).toBe('excellent');
    expect(normalized.dataQuality.score.score).toBe(100);
    expect(normalized.basisLabel).toBe('Accrual Basis');
  });

  it('renders a legacy payload as a PDF instead of throwing', async () => {
    const payload = normalizeReportPayload(legacyPayload());
    const pdf = await renderReportPdf(payload, DEFAULT_BRANDING);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  }, 60_000);

  it('renders a legacy payload as a workbook instead of throwing', async () => {
    const payload = normalizeReportPayload(legacyPayload());
    const xlsx = await renderReportWorkbook(payload);
    expect(xlsx.subarray(0, 2).toString()).toBe('PK');
  }, 60_000);

  it('survives a payload missing every optional collection', async () => {
    const stripped = legacyPayload();
    for (const key of ['headline', 'pnlRows', 'balanceSheetRows', 'trends', 'stores', 'vendorSpend', 'insights', 'anomalies', 'observations', 'expenseAnalysis', 'topOverdueReceivables', 'topPayables']) {
      delete stripped[key];
    }
    const payload = normalizeReportPayload(stripped);
    expect(payload.trends).toEqual([]);
    expect(payload.insights).toEqual([]);
    await expect(renderReportWorkbook(payload)).resolves.toBeDefined();
  }, 60_000);

  it('rejects something that is not a payload at all', () => {
    expect(() => normalizeReportPayload(null)).toThrow();
    expect(() => normalizeReportPayload('not a payload')).toThrow();
    expect(() => normalizeReportPayload([1, 2, 3])).toThrow();
  });
});
