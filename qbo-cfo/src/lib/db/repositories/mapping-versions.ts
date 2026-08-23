import { createHash } from 'node:crypto';
import { query, queryOne, withTransaction } from '../pool';
import { listMappings } from './mappings';

/**
 * Immutable account-mapping versions.
 *
 * A mapping change alters every derived figure in every period. Recording an
 * immutable version on each change, and stamping reports with the version they
 * were built from, is what stops a mapping edit today from silently rewriting
 * what last quarter's report said.
 */

export interface MappingVersion {
  id: string;
  companyId: string;
  version: number;
  mappings: Record<string, string>;
  checksum: string;
  mappedCount: number;
  changeNote: string | null;
  createdAt: string;
}

interface Row {
  id: string;
  company_id: string;
  version: number;
  mappings: Record<string, string>;
  checksum: string;
  mapped_count: number;
  change_note: string | null;
  created_at: Date;
}

function toVersion(row: Row): MappingVersion {
  return {
    id: row.id,
    companyId: row.company_id,
    version: row.version,
    mappings: row.mappings ?? {},
    checksum: row.checksum,
    mappedCount: row.mapped_count,
    changeNote: row.change_note,
    createdAt: row.created_at.toISOString(),
  };
}

/** Order-independent hash, so the same mapping set always yields one version. */
export function checksumMappings(mappings: Record<string, string>): string {
  const canonical = Object.keys(mappings)
    .sort()
    .map((k) => `${k}=${mappings[k]}`)
    .join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}

/** The effective mapping set: approved, plus suggestions at or above the auto-apply bar. */
async function currentMappingSet(companyId: string, minAutoConfidence = 0.9): Promise<Record<string, string>> {
  const rows = await listMappings(companyId);
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.approved || r.confidence >= minAutoConfidence) out[r.accountQboId] = r.categoryKey;
  }
  return out;
}

/**
 * Records the company's current mapping set as a version.
 *
 * Idempotent by checksum: calling this when nothing changed returns the
 * existing version rather than creating a duplicate.
 */
export async function captureMappingVersion(input: {
  companyId: string;
  changeNote?: string | null;
  createdBy?: string | null;
}): Promise<MappingVersion> {
  const mappings = await currentMappingSet(input.companyId);
  const checksum = checksumMappings(mappings);

  const existing = await queryOne<Row>(
    'SELECT * FROM account_mapping_versions WHERE company_id = $1 AND checksum = $2',
    [input.companyId, checksum],
  );
  if (existing) return toVersion(existing);

  return withTransaction(async (client) => {
    // Serialise version allocation for this company so two concurrent mapping
    // changes cannot claim the same version number.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `mapping_version:${input.companyId}`,
    ]);
    const raced = await client.query<Row>(
      'SELECT * FROM account_mapping_versions WHERE company_id = $1 AND checksum = $2',
      [input.companyId, checksum],
    );
    if (raced.rows[0]) return toVersion(raced.rows[0]);

    const next = await client.query<{ next: number }>(
      'SELECT COALESCE(MAX(version), 0) + 1 AS next FROM account_mapping_versions WHERE company_id = $1',
      [input.companyId],
    );
    const inserted = await client.query<Row>(
      `INSERT INTO account_mapping_versions
         (company_id, version, mappings, checksum, mapped_count, change_note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        input.companyId,
        next.rows[0]?.next ?? 1,
        JSON.stringify(mappings),
        checksum,
        Object.keys(mappings).length,
        input.changeNote ?? null,
        input.createdBy ?? null,
      ],
    );
    return toVersion(inserted.rows[0] as Row);
  });
}

export async function getMappingVersion(id: string): Promise<MappingVersion | null> {
  const row = await queryOne<Row>('SELECT * FROM account_mapping_versions WHERE id = $1', [id]);
  return row ? toVersion(row) : null;
}

export async function latestMappingVersion(companyId: string): Promise<MappingVersion | null> {
  const row = await queryOne<Row>(
    'SELECT * FROM account_mapping_versions WHERE company_id = $1 ORDER BY version DESC LIMIT 1',
    [companyId],
  );
  return row ? toVersion(row) : null;
}

export async function listMappingVersions(companyId: string, limit = 25): Promise<MappingVersion[]> {
  const rows = await query<Row>(
    'SELECT * FROM account_mapping_versions WHERE company_id = $1 ORDER BY version DESC LIMIT $2',
    [companyId, limit],
  );
  return rows.map(toVersion);
}

/** Human-readable difference between two mapping versions, for the audit trail. */
export function diffMappingVersions(
  before: MappingVersion | null,
  after: MappingVersion,
): Array<{ accountQboId: string; from: string | null; to: string | null }> {
  const prev = before?.mappings ?? {};
  const next = after.mappings;
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  const changes: Array<{ accountQboId: string; from: string | null; to: string | null }> = [];
  for (const key of keys) {
    const from = prev[key] ?? null;
    const to = next[key] ?? null;
    if (from !== to) changes.push({ accountQboId: key, from, to });
  }
  return changes.sort((a, b) => a.accountQboId.localeCompare(b.accountQboId));
}
