import { num, numOrNull, query, withTransaction } from '../pool';
import type { Anomaly } from '../../finance/types';
import type { Period } from '../../util/dates';

export async function saveAnomalies(
  companyId: string,
  period: Period,
  anomalies: Anomaly[],
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM anomalies WHERE company_id = $1 AND period_start = $2', [
      companyId,
      period.start,
    ]);
    for (const a of anomalies) {
      await client.query(
        `INSERT INTO anomalies
           (company_id, period_start, period_end, rule_key, severity, category, title, detail,
            metric_key, current_value, comparison_value, delta_amount, delta_pct, score, evidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (company_id, period_start, rule_key, title) DO UPDATE SET
           severity = EXCLUDED.severity, detail = EXCLUDED.detail, score = EXCLUDED.score,
           evidence = EXCLUDED.evidence`,
        [
          companyId, period.start, period.end, a.ruleKey, a.severity, a.category, a.title, a.detail,
          a.metricKey, a.currentValue, a.comparisonValue, a.deltaAmount, a.deltaPct, a.score,
          JSON.stringify(a.evidence),
        ],
      );
    }
  });
}

export async function getAnomalies(companyId: string, period: Period): Promise<Anomaly[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM anomalies WHERE company_id = $1 AND period_start = $2 AND status <> 'dismissed'
      ORDER BY score DESC`,
    [companyId, period.start],
  );
  return rows.map((r) => ({
    ruleKey: r['rule_key'] as string,
    severity: r['severity'] as Anomaly['severity'],
    category: r['category'] as string,
    title: r['title'] as string,
    detail: r['detail'] as string,
    metricKey: (r['metric_key'] as string | null) ?? null,
    currentValue: numOrNull(r['current_value']),
    comparisonValue: numOrNull(r['comparison_value']),
    deltaAmount: numOrNull(r['delta_amount']),
    deltaPct: numOrNull(r['delta_pct']),
    score: num(r['score']),
    evidence: (r['evidence'] as Record<string, unknown>) ?? {},
  }));
}

export async function setAnomalyStatus(
  companyId: string,
  period: Period,
  title: string,
  status: 'open' | 'acknowledged' | 'dismissed',
): Promise<void> {
  await query(
    'UPDATE anomalies SET status = $4 WHERE company_id = $1 AND period_start = $2 AND title = $3',
    [companyId, period.start, title, status],
  );
}

// --- configurable thresholds ----------------------------------------------

export interface ThresholdRow {
  ruleKey: string;
  enabled: boolean;
  params: Record<string, number>;
}

export async function listThresholds(companyId: string): Promise<ThresholdRow[]> {
  const rows = await query<{ rule_key: string; enabled: boolean; params: Record<string, number> }>(
    'SELECT rule_key, enabled, params FROM anomaly_thresholds WHERE company_id = $1',
    [companyId],
  );
  return rows.map((r) => ({ ruleKey: r.rule_key, enabled: r.enabled, params: r.params ?? {} }));
}

export async function saveThreshold(
  companyId: string,
  ruleKey: string,
  patch: { enabled?: boolean; params?: Record<string, number> },
): Promise<void> {
  await query(
    `INSERT INTO anomaly_thresholds (company_id, rule_key, enabled, params, updated_at)
     VALUES ($1,$2,COALESCE($3,TRUE),COALESCE($4,'{}'::jsonb), now())
     ON CONFLICT (company_id, rule_key) DO UPDATE SET
       enabled = COALESCE($3, anomaly_thresholds.enabled),
       params = COALESCE($4, anomaly_thresholds.params),
       updated_at = now()`,
    [companyId, ruleKey, patch.enabled ?? null, patch.params ? JSON.stringify(patch.params) : null],
  );
}
