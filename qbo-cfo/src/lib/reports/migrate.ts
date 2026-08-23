import type { ReportPayload } from './types';
import type { MappingCoverageReport } from '../finance/coverage';
import type { QualityScore } from '../finance/quality-score';
import { basisDescription, basisLabel, normalizeMethod } from '../finance/basis';

/**
 * Forward-compatibility for stored report payloads.
 *
 * A generated report is an immutable historical record: the figures it shows
 * are what the business was told, and they must stay readable after the
 * application that produced them has moved on. Fields added to `ReportPayload`
 * after a report was stored are simply absent from that report's JSON, so
 * rendering it directly crashes on the first `payload.dataQuality.score`.
 *
 * This normalises an older payload up to the current shape on read. Two rules
 * govern what it fills in:
 *
 *   1. **Never invent a figure.** Nothing here computes an amount, a ratio or
 *      a score. A field that was not recorded is presented as not recorded.
 *   2. **Say so on screen.** A backfilled quality score carries the reason
 *      "not recorded for this report version" as a deduction, and backfilled
 *      coverage is `null`, which the coverage panel renders as unknown rather
 *      than as complete.
 *
 * Regenerating the report is what produces the current figures. That is a
 * deliberate choice the owner makes, not something a read should do silently.
 */

const NOT_RECORDED = 'Not recorded for this report version. Regenerate the report to compute it.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A score that is explicitly unknown rather than a guess. */
function unknownScore(confidence: 'high' | 'medium' | 'low'): QualityScore {
  return {
    score: 0,
    band: 'unknown',
    bandLabel: 'Not scored',
    confidence,
    deductions: [{ factor: 'reportAvailability', points: 0, label: 'Data quality score', reason: NOT_RECORDED }],
  };
}

function unknownCoverage(): MappingCoverageReport {
  return {
    sections: [],
    byCategory: [],
    totalUnmappedAmount: 0,
    totalUnmappedAccounts: 0,
    overallCoverage: null,
    worstSection: null,
  };
}

/**
 * Brings a stored payload up to the current shape. Returns it unchanged when
 * it is already current, so the common path costs one property check.
 */
export function normalizeReportPayload(raw: unknown): ReportPayload {
  if (!isRecord(raw)) {
    throw new Error('Stored report payload is not an object.');
  }
  const payload = { ...raw } as Record<string, unknown>;

  // --- reporting basis (added with the basis work) -------------------------
  const method = normalizeMethod(payload['accountingMethod']);
  payload['accountingMethod'] = method;
  if (typeof payload['basisLabel'] !== 'string') payload['basisLabel'] = basisLabel(method);
  if (typeof payload['basisDescription'] !== 'string') {
    payload['basisDescription'] = basisDescription(method);
  }

  // --- data quality score --------------------------------------------------
  const quality = isRecord(payload['dataQuality']) ? { ...payload['dataQuality'] } : {};
  const confidence =
    quality['confidence'] === 'high' || quality['confidence'] === 'low' ? quality['confidence'] : 'medium';
  if (!isRecord(quality['score'])) quality['score'] = unknownScore(confidence);
  if (!Array.isArray(quality['checks'])) quality['checks'] = [];
  if (!Array.isArray(quality['reasons'])) quality['reasons'] = [];
  quality['confidence'] = confidence;
  payload['dataQuality'] = quality;

  // --- mapping coverage ----------------------------------------------------
  if (!isRecord(payload['mappingCoverage'])) payload['mappingCoverage'] = unknownCoverage();

  // --- provenance and versioning ------------------------------------------
  if (!isRecord(payload['provenance'])) payload['provenance'] = {};
  if (payload['provenanceVersion'] === undefined) payload['provenanceVersion'] = null;

  // --- comparison availability --------------------------------------------
  if (!isRecord(payload['comparisonAvailability'])) {
    const comparisons = isRecord(payload['comparisons']) ? payload['comparisons'] : {};
    const present = (key: string) => isRecord(comparisons[key]);
    payload['comparisonAvailability'] = {
      priorMonth: present('priorMonth'),
      sameMonthLastYear: present('sameMonthLastYear'),
      yearToDate: present('yearToDate'),
      priorYearToDate: present('priorYearToDate'),
      trailingMonths: Array.isArray(payload['trends']) ? payload['trends'].length : 0,
    };
  }

  // --- collections a renderer iterates -------------------------------------
  for (const key of [
    'headline', 'pnlRows', 'expenseAnalysis', 'balanceSheetRows', 'topOverdueReceivables',
    'topPayables', 'vendorSpend', 'stores', 'trends', 'anomalies', 'insights', 'observations',
  ]) {
    if (!Array.isArray(payload[key])) payload[key] = [];
  }

  payload['version'] = 1;
  return payload as unknown as ReportPayload;
}
