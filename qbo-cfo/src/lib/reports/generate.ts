import { generateInsights } from '../ai/insights';
import { getBranding, getCompany, markScheduleRun } from '../db/repositories/companies';
import { markReported } from '../db/repositories/connections';
import { saveAnomalies } from '../db/repositories/anomalies';
import { recordAudit } from '../db/repositories/audit';
import {
  completeReport,
  createOrResetReport,
  saveInsights,
  saveReportSections,
  setReportStatus,
} from '../db/repositories/reports';
import { AppError } from '../errors';
import { logger } from '../logger';
import { monthLabel, monthName, parseIsoDate, type Period } from '../util/dates';
import { buildReportPayload } from './builder';
import type { ReportPayload } from './types';

/**
 * End-to-end monthly report generation.
 *
 * Status transitions mirror what the UI displays:
 *   pending -> analyzing -> generating -> completed | failed
 * (`syncing` is set by the caller when a sync precedes generation.)
 */
export async function generateMonthlyReport(input: {
  companyId: string;
  period: Period;
  requestedBy?: string | null;
  generatedBy?: 'manual' | 'scheduled';
  skipAi?: boolean;
}): Promise<{ reportId: string; payload: ReportPayload; warning: string | null }> {
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

  try {
    await setReportStatus(reportId, 'analyzing');
    const payload = await buildReportPayload({ companyId: input.companyId, period: input.period });

    await saveAnomalies(input.companyId, input.period, payload.anomalies);

    let warning: string | null = null;
    if (!input.skipAi) {
      const result = await generateInsights(payload);
      payload.insights = result.insights;
      payload.executiveSummary = result.executiveSummary;
      warning = result.warning;
      await saveInsights(input.companyId, reportId, input.period, result.insights, result.model);
    } else {
      payload.executiveSummary = payload.observations.join(' ');
    }

    await setReportStatus(reportId, 'generating');
    await saveReportSections(reportId, buildSections(payload));

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
        confidence: payload.dataQuality.confidence,
        anomalies: payload.anomalies.length,
        generatedBy: input.generatedBy ?? 'manual',
      },
    });

    logger.info('report generated', { reportId, period: input.period.start });
    return { reportId, payload, warning };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Report generation failed';
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
