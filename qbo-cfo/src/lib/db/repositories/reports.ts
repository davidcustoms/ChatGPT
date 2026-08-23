import { query, queryOne, withTransaction } from '../pool';
import type { AiInsight } from '../../finance/types';
import type { Period } from '../../util/dates';

export type ReportStatus =
  | 'pending'
  | 'syncing'
  | 'analyzing'
  | 'generating'
  | 'completed'
  | 'failed';

export interface GeneratedReportRow {
  id: string;
  company_id: string;
  period_start: Date;
  period_end: Date;
  title: string;
  status: ReportStatus;
  confidence: 'high' | 'medium' | 'low' | null;
  confidence_reasons: string[];
  payload: unknown;
  executive_summary: string | null;
  error_message: string | null;
  generated_by: 'manual' | 'scheduled';
  created_at: Date;
  completed_at: Date | null;
}

export interface ReportSummary {
  id: string;
  companyId: string;
  period: Period;
  title: string;
  status: ReportStatus;
  confidence: 'high' | 'medium' | 'low' | null;
  confidenceReasons: string[];
  executiveSummary: string | null;
  errorMessage: string | null;
  generatedBy: 'manual' | 'scheduled';
  createdAt: string;
  completedAt: string | null;
}

function toSummary(row: GeneratedReportRow): ReportSummary {
  return {
    id: row.id,
    companyId: row.company_id,
    period: {
      start: row.period_start.toISOString().slice(0, 10),
      end: row.period_end.toISOString().slice(0, 10),
    },
    title: row.title,
    status: row.status,
    confidence: row.confidence,
    confidenceReasons: Array.isArray(row.confidence_reasons) ? row.confidence_reasons : [],
    executiveSummary: row.executive_summary,
    errorMessage: row.error_message,
    generatedBy: row.generated_by,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}

export async function createOrResetReport(input: {
  companyId: string;
  period: Period;
  title: string;
  generatedBy?: 'manual' | 'scheduled';
  requestedBy?: string | null;
}): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO generated_reports
       (company_id, period_start, period_end, title, status, generated_by, requested_by, started_at)
     VALUES ($1,$2,$3,$4,'pending',COALESCE($5,'manual'),$6, now())
     ON CONFLICT (company_id, period_start, period_end) DO UPDATE SET
       title = EXCLUDED.title,
       status = 'pending',
       error_message = NULL,
       generated_by = EXCLUDED.generated_by,
       requested_by = EXCLUDED.requested_by,
       started_at = now(),
       completed_at = NULL,
       updated_at = now()
     RETURNING id`,
    [
      input.companyId,
      input.period.start,
      input.period.end,
      input.title,
      input.generatedBy ?? null,
      input.requestedBy ?? null,
    ],
  );
  return row?.id as string;
}

export async function setReportStatus(
  reportId: string,
  status: ReportStatus,
  errorMessage?: string | null,
): Promise<void> {
  await query(
    `UPDATE generated_reports SET status = $2, error_message = $3,
            completed_at = CASE WHEN $2 IN ('completed','failed') THEN now() ELSE completed_at END,
            updated_at = now()
      WHERE id = $1`,
    [reportId, status, errorMessage ?? null],
  );
}

export async function completeReport(input: {
  reportId: string;
  payload: unknown;
  executiveSummary: string | null;
  confidence: 'high' | 'medium' | 'low';
  confidenceReasons: string[];
}): Promise<void> {
  await query(
    `UPDATE generated_reports SET status = 'completed', payload = $2, executive_summary = $3,
            confidence = $4, confidence_reasons = $5, completed_at = now(), updated_at = now(),
            error_message = NULL
      WHERE id = $1`,
    [
      input.reportId,
      JSON.stringify(input.payload),
      input.executiveSummary,
      input.confidence,
      JSON.stringify(input.confidenceReasons),
    ],
  );
}

export async function getReport(reportId: string): Promise<
  (ReportSummary & { payload: unknown }) | null
> {
  const row = await queryOne<GeneratedReportRow>('SELECT * FROM generated_reports WHERE id = $1', [
    reportId,
  ]);
  if (!row) return null;
  return { ...toSummary(row), payload: row.payload };
}

export async function getReportForPeriod(
  companyId: string,
  period: Period,
): Promise<(ReportSummary & { payload: unknown }) | null> {
  const row = await queryOne<GeneratedReportRow>(
    'SELECT * FROM generated_reports WHERE company_id = $1 AND period_start = $2 AND period_end = $3',
    [companyId, period.start, period.end],
  );
  if (!row) return null;
  return { ...toSummary(row), payload: row.payload };
}

export async function listReports(companyId: string, limit = 36): Promise<ReportSummary[]> {
  const rows = await query<GeneratedReportRow>(
    'SELECT * FROM generated_reports WHERE company_id = $1 ORDER BY period_start DESC LIMIT $2',
    [companyId, limit],
  );
  return rows.map(toSummary);
}

export async function saveReportSections(
  reportId: string,
  sections: Array<{ key: string; title: string; narrative?: string | null; data?: unknown }>,
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM report_sections WHERE report_id = $1', [reportId]);
    let order = 0;
    for (const s of sections) {
      await client.query(
        `INSERT INTO report_sections (report_id, section_key, title, sort_order, narrative, data)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [reportId, s.key, s.title, order, s.narrative ?? null, JSON.stringify(s.data ?? {})],
      );
      order += 1;
    }
  });
}

export async function saveInsights(
  companyId: string,
  reportId: string,
  period: Period,
  insights: AiInsight[],
  model: string,
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM ai_insights WHERE report_id = $1', [reportId]);
    let order = 0;
    for (const i of insights) {
      await client.query(
        `INSERT INTO ai_insights
           (company_id, report_id, period_start, category, severity, observation,
            supporting_metrics, likely_implication, recommended_action, confidence, model, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          companyId, reportId, period.start, i.category, i.severity, i.observation,
          JSON.stringify(i.supportingMetrics), i.likelyImplication, i.recommendedAction,
          i.confidence, model, order,
        ],
      );
      order += 1;
    }
  });
}

export async function getInsights(reportId: string): Promise<AiInsight[]> {
  const rows = await query<{
    category: string;
    severity: AiInsight['severity'];
    observation: string;
    supporting_metrics: string[];
    likely_implication: string | null;
    recommended_action: string | null;
    confidence: AiInsight['confidence'];
  }>('SELECT * FROM ai_insights WHERE report_id = $1 ORDER BY sort_order', [reportId]);
  return rows.map((r) => ({
    category: r.category,
    severity: r.severity,
    observation: r.observation,
    supportingMetrics: Array.isArray(r.supporting_metrics) ? r.supporting_metrics : [],
    likelyImplication: r.likely_implication ?? '',
    recommendedAction: r.recommended_action ?? '',
    confidence: r.confidence,
  }));
}
