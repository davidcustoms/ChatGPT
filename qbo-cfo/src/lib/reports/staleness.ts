import { getCompany } from '../db/repositories/companies';
import { latestReportVersion, type ReportVersion } from '../db/repositories/report-versions';
import { latestMappingVersion } from '../db/repositories/mapping-versions';
import { snapshotFingerprint } from '../db/repositories/snapshots';
import type { Period } from '../util/dates';

/**
 * Detects when a generated report no longer reflects what QuickBooks holds.
 *
 * A report is a statement about a moment. If a bookkeeper posts a correcting
 * journal entry after the report was produced, silently rewriting the report
 * would destroy the record of what the owner was told. Instead the report is
 * left exactly as generated and flagged, so the owner chooses whether to keep
 * it or regenerate.
 */

export type StalenessReason = 'source_data_changed' | 'mapping_changed' | 'none';

export interface ReportStaleness {
  stale: boolean;
  reasons: StalenessReason[];
  message: string | null;
  /** Fingerprint recorded when the report was generated. */
  generatedFingerprint: string;
  /** Fingerprint of the data currently stored for the period. */
  currentFingerprint: string;
  generatedMappingVersion: number | null;
  currentMappingVersion: number | null;
  generatedAt: string;
  version: number;
}

export async function checkReportStaleness(input: {
  reportId: string;
  companyId: string;
  period: Period;
}): Promise<ReportStaleness | null> {
  const version = await latestReportVersion(input.reportId);
  if (!version) return null;
  return compareAgainstCurrent(version, input.companyId, input.period);
}

export async function compareAgainstCurrent(
  version: ReportVersion,
  companyId: string,
  period: Period,
): Promise<ReportStaleness> {
  const company = await getCompany(companyId);
  const [current, mappingVersion] = await Promise.all([
    snapshotFingerprint(companyId, period, company?.accountingMethod ?? version.accountingMethod),
    latestMappingVersion(companyId),
  ]);

  const reasons: StalenessReason[] = [];
  if (version.sourceFingerprint && current.fingerprint !== version.sourceFingerprint) {
    reasons.push('source_data_changed');
  }
  if (
    version.mappingVersion !== null &&
    mappingVersion !== null &&
    mappingVersion.version !== version.mappingVersion
  ) {
    reasons.push('mapping_changed');
  }

  const messages: string[] = [];
  if (reasons.includes('source_data_changed')) {
    messages.push('QuickBooks data changed after this report was generated.');
  }
  if (reasons.includes('mapping_changed')) {
    messages.push(
      `Account mappings changed after this report was generated (version ${version.mappingVersion} → ${mappingVersion?.version}).`,
    );
  }

  return {
    stale: reasons.length > 0,
    reasons: reasons.length > 0 ? reasons : ['none'],
    message: messages.length > 0 ? `${messages.join(' ')} The figures below are exactly as generated and have not been altered.` : null,
    generatedFingerprint: version.sourceFingerprint,
    currentFingerprint: current.fingerprint,
    generatedMappingVersion: version.mappingVersion,
    currentMappingVersion: mappingVersion?.version ?? null,
    generatedAt: version.generatedAt,
    version: version.version,
  };
}
