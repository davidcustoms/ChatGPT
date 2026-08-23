import { num, query, queryOne, withTransaction } from '../pool';
import { DEFAULT_CATEGORIES } from '../../finance/categories';

export interface MappingRow {
  accountQboId: string;
  categoryKey: string;
  confidence: number;
  source: 'manual' | 'suggested' | 'default';
  approved: boolean;
  suggestedReason: string | null;
}

export async function listMappings(companyId: string): Promise<MappingRow[]> {
  const rows = await query<{
    account_qbo_id: string;
    category_key: string;
    confidence: string;
    source: 'manual' | 'suggested' | 'default';
    approved: boolean;
    suggested_reason: string | null;
  }>('SELECT * FROM account_mappings WHERE company_id = $1', [companyId]);
  return rows.map((r) => ({
    accountQboId: r.account_qbo_id,
    categoryKey: r.category_key,
    confidence: num(r.confidence),
    source: r.source,
    approved: r.approved,
    suggestedReason: r.suggested_reason,
  }));
}

/**
 * Effective mapping used by the metric engine.
 *
 * Only *approved* mappings, plus high-confidence suggestions, are applied.
 * Low-confidence suggestions stay pending until the owner approves them, so an
 * uncertain guess never silently moves money between categories.
 */
export async function effectiveMappingIndex(
  companyId: string,
  minAutoConfidence = 0.9,
): Promise<Map<string, string>> {
  const rows = await listMappings(companyId);
  const index = new Map<string, string>();
  for (const r of rows) {
    if (r.approved || r.confidence >= minAutoConfidence) index.set(r.accountQboId, r.categoryKey);
  }
  return index;
}

export async function upsertMappings(
  companyId: string,
  mappings: Array<{
    accountQboId: string;
    categoryKey: string;
    confidence?: number;
    source?: 'manual' | 'suggested' | 'default';
    approved?: boolean;
    suggestedReason?: string | null;
    approvedBy?: string | null;
  }>,
): Promise<number> {
  if (mappings.length === 0) return 0;
  await withTransaction(async (client) => {
    for (const m of mappings) {
      await client.query(
        `INSERT INTO account_mappings
           (company_id, account_qbo_id, category_key, confidence, source, approved, suggested_reason, approved_by, approved_at)
         VALUES ($1,$2,$3,COALESCE($4,1.0),COALESCE($5,'manual'),COALESCE($6,FALSE),$7,$8,
                 CASE WHEN COALESCE($6,FALSE) THEN now() ELSE NULL END)
         ON CONFLICT (company_id, account_qbo_id) DO UPDATE SET
           category_key = EXCLUDED.category_key,
           confidence = EXCLUDED.confidence,
           source = EXCLUDED.source,
           approved = EXCLUDED.approved,
           suggested_reason = EXCLUDED.suggested_reason,
           approved_by = EXCLUDED.approved_by,
           approved_at = CASE WHEN EXCLUDED.approved THEN now() ELSE account_mappings.approved_at END,
           updated_at = now()`,
        [
          companyId,
          m.accountQboId,
          m.categoryKey,
          m.confidence ?? null,
          m.source ?? null,
          m.approved ?? null,
          m.suggestedReason ?? null,
          m.approvedBy ?? null,
        ],
      );
    }
  });
  return mappings.length;
}

/** Inserts suggestions only where no mapping exists yet (never overwrites the owner). */
export async function insertSuggestionsIfMissing(
  companyId: string,
  suggestions: Array<{
    accountQboId: string;
    categoryKey: string;
    confidence: number;
    reason: string;
  }>,
): Promise<number> {
  if (suggestions.length === 0) return 0;
  let inserted = 0;
  await withTransaction(async (client) => {
    for (const s of suggestions) {
      const res = await client.query(
        `INSERT INTO account_mappings
           (company_id, account_qbo_id, category_key, confidence, source, approved, suggested_reason)
         VALUES ($1,$2,$3,$4,'suggested',FALSE,$5)
         ON CONFLICT (company_id, account_qbo_id) DO NOTHING`,
        [companyId, s.accountQboId, s.categoryKey, s.confidence, s.reason],
      );
      inserted += res.rowCount ?? 0;
    }
  });
  return inserted;
}

export async function approveMapping(
  companyId: string,
  accountQboId: string,
  userId: string,
): Promise<void> {
  await query(
    `UPDATE account_mappings SET approved = TRUE, source = 'manual', approved_by = $3,
            approved_at = now(), updated_at = now()
      WHERE company_id = $1 AND account_qbo_id = $2`,
    [companyId, accountQboId, userId],
  );
}

export async function deleteMapping(companyId: string, accountQboId: string): Promise<void> {
  await query('DELETE FROM account_mappings WHERE company_id = $1 AND account_qbo_id = $2', [
    companyId,
    accountQboId,
  ]);
}

// --- custom categories -----------------------------------------------------

export interface CategoryRow {
  key: string;
  label: string;
  section: string;
  sortOrder: number;
  isCustom: boolean;
}

export async function listCategories(companyId: string): Promise<CategoryRow[]> {
  const rows = await query<{
    key: string;
    label: string;
    section: string;
    sort_order: number;
    is_custom: boolean;
  }>('SELECT * FROM management_categories WHERE company_id = $1 ORDER BY sort_order, label', [
    companyId,
  ]);
  const custom = rows.map((r) => ({
    key: r.key,
    label: r.label,
    section: r.section,
    sortOrder: r.sort_order,
    isCustom: r.is_custom,
  }));
  const builtIn = DEFAULT_CATEGORIES.filter((d) => !custom.some((c) => c.key === d.key)).map((d) => ({
    key: d.key,
    label: d.label,
    section: d.section as string,
    sortOrder: d.sortOrder,
    isCustom: false,
  }));
  return [...builtIn, ...custom].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

export async function createCategory(
  companyId: string,
  input: { key: string; label: string; section: string; sortOrder?: number },
): Promise<void> {
  await query(
    `INSERT INTO management_categories (company_id, key, label, section, sort_order, is_custom)
     VALUES ($1,$2,$3,$4,COALESCE($5,500),TRUE)
     ON CONFLICT (company_id, key) DO UPDATE SET label = EXCLUDED.label, section = EXCLUDED.section`,
    [companyId, input.key, input.label, input.section, input.sortOrder ?? null],
  );
}

export async function countUnmappedExpenseAccounts(companyId: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM accounts a
      WHERE a.company_id = $1
        AND a.is_active
        AND a.account_type IN ('Expense','Other Expense','Cost of Goods Sold')
        AND NOT EXISTS (
          SELECT 1 FROM account_mappings m
           WHERE m.company_id = a.company_id AND m.account_qbo_id = a.qbo_id
             AND (m.approved OR m.confidence >= 0.9))`,
    [companyId],
  );
  return Number(row?.count ?? 0);
}
