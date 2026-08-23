import { generateInsights } from '../ai/insights';
import { getBranding, getCompany, markScheduleRun } from '../db/repositories/companies';
import { markReported } from '../db/repositories/connections';
import { saveAnomalies } from '../db/repositories/anomalies';
import { recordAudit } from '../db/repositories/audit';
import { captureMappingVersion } from '../db/repositories/mapping-versions';
import { appendReportVersion } from '../db/repositories/report-versions';
import {
  completeReport,
  createOrResetReport,
  saveInsights,
  saveReportSections,
  setReportStatus,
} from '../db/repositories/reports';
import { AppError } from '../errors';
import { logger } from '../logger';
import { event } from '../observability';
import { APP_VERSION } from '../version';
import { monthLabel, monthName, parseIsoDate, type Period } from '../util/dates';
import { buildReportPayload } from './builder';
import type { ReportPayload } from './types';

/**
 * End-to-end monthly report generation.
 *
 * Status transitions mirror what the UI displays:
 *   pending -> analyzing -> generating -> completed | failed
 * (`syncing` is set by the caller when a sync precedes generation.)
 *
 * Generation never overwrites history. Each run appends an immutable report
 * version recording the snapshots, mapping version, prompt version,
 * application version, basis and user that produced it.
 */
export async function generateMonthlyReport(input: {
  companyId: string;
  period: Period;
  requestedBy?: string | null;
  generatedBy?: 'manual' | 'scheduled';
  skipAi?: boolean;
}): Promise<{
  reportId: string;
  version: number;
  payload: ReportPayload;
  warning: string | null;
}> {
  const company = await getCompany(input.companyId);
  if (!company) throw new AppError('NOT_FOUND', 'Company not found.');

  const branding = await getBranding(input.companyId);
  const { year, month } = parseIsoDate(input.period.start);
  const title = branding.reportTitleTemplate
    .replace('{month}', monthName(month))
    .replace('{year}', String(year))
    .replace('{company}', branding.businessName ?? company.name);

  const reportId = await createOrResetReport({
    companyId: input.companyId,
    period: input.period,
    title,
    generatedBy: input.generatedBy ?? 'manual',
    requestedBy: input.requestedBy ?? null,
  });

  const startedAt = Date.now();
  event('report.started', {
    companyId: input.companyId,
    reportId,
    period: input.period.start,
    status: input.generatedBy ?? 'manual',
  });

  try {
    await setReportStatus(reportId, 'analyzing');

    // The mapping in force right now becomes an immutable version, so this
    // report can always be reproduced even after mappings change later.
    const mappingVersion = await captureMappingVersion({
      companyId: input.companyId,
      changeNote: `Captured for ${monthLabel(input.period)} report`,
      createdBy: input.requestedBy ?? null,
    });

    const { payload, source } = await buildReportPayload({
      companyId: input.companyId,
      period: input.period,
    });

    await saveAnomalies(input.companyId, input.period, payload.anomalies);

    let warning: string | null = null;
    let promptVersion = 'deterministic_v1.0';
    let aiModel: string | null = null;

    if (!input.skipAi) {
      const result = await generateInsights(payload);
      payload.insights = result.insights;
      payload.executiveSummary = result.executiveSummary;
      warning = result.warning;
      promptVersion = result.promptVersion;
      aiModel = result.aiUsed ? result.model : null;
      await saveInsights(
        input.companyId,
        reportId,
        input.period,
        result.insights,
        result.model,
        result.promptVersion,
      );
    } else {
      payload.executiveSummary = payload.observations.join(' ');
    }

    payload.provenanceVersion = {
      // Filled with the real number immediately after the version row is written.
      reportVersion: 0,
      appVersion: APP_VERSION,
      aiPromptVersion: promptVersion,
      aiModel,
      mappingVersion: mappingVersion.version,
      mappingVersionId: mappingVersion.id,
      sourceFingerprint: source.fingerprint,
      sourceSnapshotIds: source.snapshotIds,
    };

    await setReportStatus(reportId, 'generating');
    await saveReportSections(reportId, buildSections(payload));

    const version = await appendReportVersion({
      reportId,
      companyId: input.companyId,
      period: input.period,
      payload,
      executiveSummary: payload.executiveSummary,
      confidence: payload.dataQuality.confidence,
      confidenceScore: payload.dataQuality.score.score,
      accountingMethod: payload.accountingMethod,
      sourceSnapshotIds: source.snapshotIds,
      sourceFingerprint: source.fingerprint,
      mappingVersionId: mappingVersion.id,
      mappingVersion: mappingVersion.version,
      aiPromptVersion: promptVersion,
      aiModel,
      appVersion: APP_VERSION,
      generatedBy: input.generatedBy ?? 'manual',
      generatedByUser: input.requestedBy ?? null,
    });

    // Stamp the real version number into the payload and persist once more, so
    // the stored head and the stored version agree on what version they are.
    payload.provenanceVersion.reportVersion = version.version;

    await completeReport({
      reportId,
      payload,
      executiveSummary: payload.executiveSummary,
      confidence: payload.dataQuality.confidence,
      confidenceReasons: payload.dataQuality.reasons,
    });

    await markReported(input.companyId);
    await recordAudit({
      companyId: input.companyId,
      userId: input.requestedBy ?? null,
      action: 'report.generated',
      entityType: 'report',
      entityId: reportId,
      metadata: {
        period: input.period.start,
        version: version.version,
        confidence: payload.dataQuality.confidence,
        confidenceScore: payload.dataQuality.score.score,
        basis: payload.accountingMethod,
        mappingVersion: mappingVersion.version,
        promptVersion,
        appVersion: APP_VERSION,
        anomalies: payload.anomalies.length,
        generatedBy: input.generatedBy ?? 'manual',
      },
    });

    event('anomaly.generated', {
      companyId: input.companyId,
      period: input.period.start,
      count: payload.anomalies.length,
    });
    event('report.finished', {
      companyId: input.companyId,
      reportId,
      period: input.period.start,
      version: version.version,
      basis: payload.accountingMethod,
      score: payload.dataQuality.score.score,
      durationMs: Date.now() - startedAt,
    });

    return { reportId, version: version.version, payload, warning };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Report generation failed';
    event('report.failed', {
      companyId: input.companyId,
      reportId,
      period: input.period.start,
      reason: message,
      durationMs: Date.now() - startedAt,
    });
    await setReportStatus(reportId, 'failed', message);
    await recordAudit({
      companyId: input.companyId,
      userId: input.requestedBy ?? null,
      action: 'report.generation_failed',
      entityType: 'report',
      entityId: reportId,
      outcome: 'failure',
      metadata: { period: input.period.start, message },
    });
    await markScheduleRun(input.companyId, 'failed').catch(() => undefined);
    throw err;
  }
}

/** Section list mirroring the report layout (A through J plus risks/actions). */
function buildSections(payload: ReportPayload): Array<{
  key: string;
  title: string;
  narrative?: string | null;
  data?: unknown;
}> {
  return [
    {
      key: 'executive_summary',
      title: 'Executive Summary',
      narrative: payload.executiveSummary,
      data: { headline: payload.headline, observations: payload.observations },
    },
    { key: 'profit_and_loss', title: 'Profit & Loss', data: { rows: payload.pnlRows } },
    { key: 'expense_analysis', title: 'Expense Analysis', data: { rows: payload.expenseAnalysis } },
    { key: 'balance_sheet', title: 'Balance Sheet', data: { rows: payload.balanceSheetRows } },
    { key: 'cash_position', title: 'Cash Position', data: payload.cashPosition },
    { key: 'receivables', title: 'Accounts Receivable', data: { aging: payload.arAging, top: payload.topOverdueReceivables } },
    { key: 'payables', title: 'Accounts Payable', data: { aging: payload.apAging, top: payload.topPayables } },
    { key: 'vendors', title: 'Vendor Spending', data: { rows: payload.vendorSpend } },
    {
      key: 'stores',
      title: `Store Performance (${payload.storeContributionLabel})`,
      narrative: payload.storeNote,
      data: { rows: payload.stores, dimension: payload.storeDimension },
    },
    { key: 'trends', title: '12-Month Trends', data: { points: payload.trends } },
    {
      key: 'data_quality',
      title: 'Data Quality',
      data: {
        score: payload.dataQuality.score,
        checks: payload.dataQuality.checks,
        mappingCoverage: payload.mappingCoverage,
      },
    },
    {
      key: 'risks',
      title: 'Risks & Opportunities',
      data: { anomalies: payload.anomalies, insights: payload.insights },
    },
    {
      key: 'actions',
      title: 'Recommended Actions',
      data: {
        actions: payload.insights.map((i) => ({
          category: i.category,
          severity: i.severity,
          action: i.recommendedAction,
          confidence: i.confidence,
        })),
      },
    },
  ];
}

export { monthLabel };
