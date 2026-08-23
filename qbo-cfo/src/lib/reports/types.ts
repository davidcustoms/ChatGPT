import type { PnlRow } from '../finance/comparisons';
import type { CashPosition } from '../finance/comparisons';
import type { ExpenseCategoryLine } from '../finance/metrics';
import type { QualityCheck } from '../finance/data-quality';
import type { StorePerformanceRow } from '../finance/locations';
import type {
  AgingSnapshot,
  AiInsight,
  Anomaly,
  KpiSet,
  MonthlyMetrics,
} from '../finance/types';
import type { Period } from '../util/dates';
import type { AccountingMethod } from '../finance/basis';
import type { MappingCoverageReport } from '../finance/coverage';
import type { QualityScore } from '../finance/quality-score';
import type { MetricProvenance } from './provenance';

export interface HeadlineMetric {
  key: string;
  label: string;
  value: number | null;
  format: 'currency' | 'percent' | 'ratio';
  changeAmount: number | null;
  changePct: number | null;
  /** Percentage-point move, for ratio metrics such as margin. */
  changePoints: number | null;
  yoyPct: number | null;
  comparisonLabel: string;
}

export interface TrendPoint {
  period: string;
  label: string;
  revenue: number;
  grossProfit: number;
  grossMargin: number | null;
  netIncome: number;
  operatingExpenses: number;
  cash: number | null;
  accountsReceivable: number | null;
  accountsPayable: number | null;
  payrollPctRevenue: number | null;
  advertisingPctRevenue: number | null;
}

export interface VendorSpendRow {
  vendorName: string;
  current: number;
  previous: number | null;
  changeAmount: number | null;
  changePct: number | null;
  yearToDate: number;
  flagged: boolean;
}

export interface BalanceSheetRow {
  key: string;
  label: string;
  current: number | null;
  previous: number | null;
  changeAmount: number | null;
  emphasis?: 'total' | 'subtotal' | 'normal';
}

export interface ComparisonSet {
  priorMonth: MonthlyMetrics | null;
  sameMonthLastYear: MonthlyMetrics | null;
  yearToDate: MonthlyMetrics | null;
  priorYearToDate: MonthlyMetrics | null;
  trailing12: MonthlyMetrics | null;
}

/** Everything the report renders. Computed deterministically, then narrated. */
export interface ReportPayload {
  version: 1;
  companyId: string;
  companyName: string;
  currency: string;
  period: Period;
  periodLabel: string;
  generatedAt: string;
  dataThrough: string;
  sourceSystem: string;

  /** Reporting basis. Displayed on every surface; never mixed within a report. */
  accountingMethod: AccountingMethod;
  basisLabel: string;
  basisDescription: string;

  /** Recorded at generation time so any historical output can be reproduced. */
  provenanceVersion: {
    reportVersion: number;
    appVersion: string;
    aiPromptVersion: string;
    aiModel: string | null;
    mappingVersion: number | null;
    mappingVersionId: string | null;
    sourceFingerprint: string;
    sourceSnapshotIds: string[];
  } | null;

  metrics: MonthlyMetrics;
  comparisons: ComparisonSet;
  kpis: KpiSet;
  headline: HeadlineMetric[];

  pnlRows: PnlRow[];
  expenseAnalysis: ExpenseCategoryLine[];
  balanceSheetRows: BalanceSheetRow[];
  cashPosition: CashPosition;

  arAging: AgingSnapshot | null;
  apAging: AgingSnapshot | null;
  topOverdueReceivables: Array<{ name: string; amount: number; over90: number }>;
  topPayables: Array<{ name: string; amount: number; over90: number }>;

  vendorSpend: VendorSpendRow[];

  stores: StorePerformanceRow[];
  storeDimension: 'location' | 'class' | 'none';
  storeContributionLabel: string;
  storeNote: string;

  trends: TrendPoint[];

  anomalies: Anomaly[];
  insights: AiInsight[];
  observations: string[];
  executiveSummary: string | null;

  /** Dollar-weighted mapping coverage, and per-category analysis confidence. */
  mappingCoverage: MappingCoverageReport;

  /** How every headline figure was produced. */
  provenance: Record<string, MetricProvenance>;

  /** Which comparison windows actually have data behind them. */
  comparisonAvailability: {
    priorMonth: boolean;
    sameMonthLastYear: boolean;
    yearToDate: boolean;
    priorYearToDate: boolean;
    trailingMonths: number;
  };

  dataQuality: {
    checks: QualityCheck[];
    /** Deterministic 0-100 score. The AI layer may cite it but never change it. */
    score: QualityScore;
    confidence: 'high' | 'medium' | 'low';
    reasons: string[];
  };
}
