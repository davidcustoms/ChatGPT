import { query, queryOne, withTransaction } from '../pool';
import type { AccountingMethod } from '../../finance/basis';
import type { Period } from '../../util/dates';

/**
 * Immutable report versions.
 *
 * Regenerating a month appends a version rather than overwriting one. Each
 * records exactly what produced it -- snapshots, mapping version, prompt
 * version, application version, basis and user -- so any figure an owner or
 * their accountant saw months ago can be reproduced and explained.
 */

export interface ReportVersion {
  id: string;
  reportId: string;
  companyId: string;
  version: number;
  period: Period;
  payload: unknown;
  executiveSummary: string | null;
  confidence: string | null;
  confidenceScore: number | null;
  accountingMethod: AccountingMethod;
  sourceSnapshotIds: string[];
  sourceFingerprint: string;
  mappingVersionId: string | null;
  mappingVersion: number | null;
  aiPromptVersion: string;
  aiModel: string | null;
  appVersion: string;
  generatedBy: string;
  generatedByUser: string | null;
  generatedAt: string;
}

interface Row {
  id: string;
  report_id: string;
  company_id: string;
  version: number;
  period_start: Date;
  period_end: Date;
  payload: unknown;
  executive_summary: string | null;
  confidence: string | null;
  confidence_score: number | null;
  accounting_method: AccountingMethod;
  source_snapshot_ids: string[];
  source_fingerprint: string;
  mapping_version_id: string | null;
  mapping_version: number | null;
  ai_prompt_version: string;
  ai_model: string | null;
  app_version: string;
  generated_by: string;
  generated_by_user: string | null;
  generated_at: Date;
}

function toVersion(row: Row): ReportVersion {
  return {
    id: row.id,
    reportId: row.report_id,
    companyId: row.company_id,
    version: row.version,
    period: {
      start: row.period_start.toISOString().slice(0, 10),
      end: row.period_end.toISOString().slice(0, 10),
    },
    payload: row.payload,
    executiveSummary: row.executive_summary,
    confidence: row.confidence,
    confidenceScore: row.confidence_score,
    accountingMethod: row.accounting_method,
    sourceSnapshotIds: row.source_snapshot_ids ?? [],
    sourceFingerprint: row.source_fingerprint,
    mappingVersionId: row.mapping_version_id,
    mappingVersion: row.mapping_version,
    aiPromptVersion: row.ai_prompt_version,
    aiModel: row.ai_model,
    appVersion: row.app_version,
    generatedBy: row.generated_by,
    generatedByUser: row.generated_by_user,
    generatedAt: row.generated_at.toISOString(),
  };
}

export interface AppendVersionInput {
  reportId: string;
  companyId: string;
  period: Period;
  payload: unknown;
  executiveSummary: string | null;
  confidence: string;
  confidenceScore: number;
  accountingMethod: AccountingMethod;
  sourceSnapshotIds: string[];
  sourceFingerprint: string;
  mappingVersionId: string | null;
  mappingVersion: number | null;
  aiPromptVersion: string;
  aiModel: string | null;
  appVersion: string;
  generatedBy: string;
  generatedByUser: string | null;
}

/** Appends the next version and advances the report's head pointer. */
export async function appendReportVersion(input: AppendVersionInput): Promise<ReportVersion> {
  return withTransaction(async (client) => {
    // Serialise version allocation for this report.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `report_version:${input.reportId}`,
    ]);
    const next = await client.query<{ next: number }>(
      'SELECT COALESCE(MAX(version), 0) + 1 AS next FROM report_versions WHERE report_id = $1',
      [input.reportId],
    );
    const version = next.rows[0]?.next ?? 1;

    const inserted = await client.query<Row>(
      `INSERT INTO report_versions
         (report_id, company_id, version, period_start, period_end, payload, executive_summary,
          confidence, confidence_score, accounting_method, source_snapshot_ids, source_fingerprint,
          mapping_version_id, mapping_version, ai_prompt_version, ai_model, app_version,
          generated_by, generated_by_user)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        input.reportId, input.companyId, version, input.period.start, input.period.end,
        JSON.stringify(input.payload), input.executiveSummary, input.confidence,
        input.confidenceScore, input.accountingMethod, input.sourceSnapshotIds,
        input.sourceFingerprint, input.mappingVersionId, input.mappingVersion,
        input.aiPromptVersion, input.aiModel, input.appVersion, input.generatedBy,
        input.generatedByUser,
      ],
    );

    await client.query(
      `UPDATE generated_reports
          SET current_version = $2,
              confidence_score = $3,
              accounting_method = $4,
              source_fingerprint = $5,
              updated_at = now()
        WHERE id = $1`,
      [
        input.reportId,
        version,
        input.confidenceScore,
        input.accountingMethod,
        input.sourceFingerprint,
      ],
    );

    return toVersion(inserted.rows[0] as Row);
  });
}

export async function listReportVersions(reportId: string): Promise<ReportVersion[]> {
  const rows = await query<Row>(
    'SELECT * FROM report_versions WHERE report_id = $1 ORDER BY version DESC',
    [reportId],
  );
  return rows.map(toVersion);
}

export async function getReportVersion(
  reportId: string,
  version: number,
): Promise<ReportVersion | null> {
  const row = await queryOne<Row>(
    'SELECT * FROM report_versions WHERE report_id = $1 AND version = $2',
    [reportId, version],
  );
  return row ? toVersion(row) : null;
}

export async function latestReportVersion(reportId: string): Promise<ReportVersion | null> {
  const row = await queryOne<Row>(
    'SELECT * FROM report_versions WHERE report_id = $1 ORDER BY version DESC LIMIT 1',
    [reportId],
  );
  return row ? toVersion(row) : null;
}

/** Version metadata without the payload, for listings. */
export async function listVersionSummaries(
  reportId: string,
): Promise<Array<Omit<ReportVersion, 'payload'>>> {
  const rows = await query<Omit<Row, 'payload'>>(
    `SELECT id, report_id, company_id, version, period_start, period_end, executive_summary,
            confidence, confidence_score, accounting_method, source_snapshot_ids,
            source_fingerprint, mapping_version_id, mapping_version, ai_prompt_version,
            ai_model, app_version, generated_by, generated_by_user, generated_at
       FROM report_versions WHERE report_id = $1 ORDER BY version DESC`,
    [reportId],
  );
  return rows.map((r) => {
    const { payload: _ignored, ...rest } = toVersion({ ...r, payload: null } as Row);
    return rest;
  });
}
