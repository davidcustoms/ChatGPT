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

  dataQuality: {
    checks: QualityCheck[];
    confidence: 'high' | 'medium' | 'low';
    reasons: string[];
  };
}
