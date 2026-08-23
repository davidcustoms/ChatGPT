/**
 * Live production validation.
 *
 * Proving that this application, pointed at a real QuickBooks company,
 * produces the same figures the QuickBooks UI shows. Every check is read-only
 * against QuickBooks; the only writes are to this application's own database.
 *
 * The vocabulary matters. A check is:
 *
 *   PASS          the thing was tested and was correct
 *   FAIL          the thing was tested and was wrong -- an application defect
 *   NOT_AVAILABLE QuickBooks does not offer this for this company. Not a
 *                 defect, and never counted as a failure
 *   NEEDS_REVIEW  correct as far as the application can tell, but a human has
 *                 to confirm it (a mapping suggestion, a store assignment)
 *
 * Conflating NOT_AVAILABLE with FAIL is the mistake that makes a validation
 * report useless: most QuickBooks companies do not have Locations, or cannot
 * produce a Statement of Cash Flows, and neither says anything about this
 * application.
 */

export type CheckStatus = 'PASS' | 'FAIL' | 'NOT_AVAILABLE' | 'NEEDS_REVIEW';

export interface ValidationCheck {
  key: string;
  area: string;
  name: string;
  status: CheckStatus;
  detail: string;
  /** What the owner should do. Present on FAIL and NEEDS_REVIEW. */
  remedy?: string;
  durationMs?: number;
}

export interface ValidationSection {
  key: string;
  title: string;
  checks: ValidationCheck[];
  /** Free-form tables the UI renders under the section. */
  tables?: ValidationTable[];
  note?: string;
}

export interface ValidationTable {
  title: string;
  columns: string[];
  /** Aligned with `columns`. `status` colours the row when present. */
  rows: Array<{ cells: string[]; status?: CheckStatus }>;
  caption?: string;
}

/**
 * The fourteen conditions that gate "Production Ready".
 *
 * Written out rather than derived so the list cannot drift from what was
 * promised. `NOT_AVAILABLE` satisfies a criterion only where marked, because
 * some of these are about company configuration rather than correctness.
 */
export const GATE_CRITERIA = [
  { key: 'production_oauth', label: 'Production OAuth' },
  { key: 'live_connection', label: 'Live company connection' },
  { key: 'token_refresh', label: 'Token refresh' },
  { key: 'closed_month_sync', label: 'Closed-month sync' },
  { key: 'reconciliation', label: 'Reconciliation' },
  { key: 'date_validation', label: 'Date validation' },
  { key: 'account_mapping', label: 'Account mapping reviewed' },
  { key: 'drilldown', label: 'Drill-down reconciliation' },
  { key: 'chat_qa', label: 'CFO Chat live QA' },
  { key: 'pdf_qa', label: 'PDF QA' },
  { key: 'excel_qa', label: 'Excel QA' },
  { key: 'report_versioning', label: 'Report versioning' },
  { key: 'tenant_security', label: 'Tenant security' },
  { key: 'read_only', label: 'Read-only guarantee' },
] as const;

export type GateKey = (typeof GATE_CRITERIA)[number]['key'];

export interface GateResult {
  key: GateKey;
  label: string;
  status: CheckStatus;
  /** Why it is not passing. Empty when it passes. */
  blocker: string | null;
}

export interface ValidationRun {
  generatedAt: string;
  appVersion: string;
  environment: 'sandbox' | 'production';
  company: {
    id: string;
    /** The name QuickBooks reports, not the one typed into this application. */
    quickbooksName: string | null;
    localName: string;
    realmId: string | null;
  };
  period: {
    start: string;
    end: string;
    label: string;
    accountingMethod: 'Accrual' | 'Cash';
    asOfDate: string;
  } | null;
  sections: ValidationSection[];
  gate: GateResult[];
  productionReady: boolean;
  blockers: string[];
  /** 0-100. Null when no report could be built. */
  confidenceScore: number | null;
  /** Fatal error that stopped the run before it could finish. */
  fatal: string | null;
}

export function pass(key: string, area: string, name: string, detail: string, durationMs?: number): ValidationCheck {
  return { key, area, name, status: 'PASS', detail, ...(durationMs !== undefined ? { durationMs } : {}) };
}

export function fail(key: string, area: string, name: string, detail: string, remedy: string): ValidationCheck {
  return { key, area, name, status: 'FAIL', detail, remedy };
}

export function notAvailable(key: string, area: string, name: string, detail: string): ValidationCheck {
  return { key, area, name, status: 'NOT_AVAILABLE', detail };
}

export function needsReview(key: string, area: string, name: string, detail: string, remedy: string): ValidationCheck {
  return { key, area, name, status: 'NEEDS_REVIEW', detail, remedy };
}

/** True when nothing in the list is a defect. NOT_AVAILABLE is not a defect. */
export function noFailures(checks: ValidationCheck[]): boolean {
  return checks.every((c) => c.status !== 'FAIL');
}

export function checksFor(sections: ValidationSection[], sectionKey: string): ValidationCheck[] {
  return sections.find((s) => s.key === sectionKey)?.checks ?? [];
}

export function findCheck(sections: ValidationSection[], key: string): ValidationCheck | undefined {
  for (const section of sections) {
    const found = section.checks.find((c) => c.key === key);
    if (found) return found;
  }
  return undefined;
}
