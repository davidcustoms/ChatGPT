import type { Period } from '../util/dates';
import type { AccountingMethod } from './basis';

/** A QuickBooks account as mirrored locally. */
export interface AccountRecord {
  qboId: string;
  name: string;
  fullyQualifiedName: string | null;
  accountNumber: string | null;
  accountType: string | null;
  accountSubType: string | null;
  classification: string | null;
  parentQboId: string | null;
  isActive: boolean;
  currentBalance: number | null;
}

/** Signed monthly amount for a single account (expenses positive). */
export interface AccountAmount {
  accountQboId: string;
  accountName: string;
  classification: string | null;
  categoryKey: string | null;
  amount: number;
}

/**
 * Fully computed monthly metric set. Every field is derived from stored
 * QuickBooks snapshots -- no value here is ever produced by a language model.
 */
export interface MonthlyMetrics {
  companyId: string;
  period: Period;
  /** The basis these figures were produced on. Never mixed within a report. */
  accountingMethod: AccountingMethod;

  grossSales: number;
  discounts: number;
  refunds: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number | null;

  operatingExpenses: number;
  payrollExpense: number;
  advertisingExpense: number;
  rentExpense: number;
  deliveryExpense: number;
  freightExpense: number;
  warehouseExpense: number;
  financingFees: number;
  merchantFees: number;
  bankFees: number;
  interestExpense: number;
  utilitiesExpense: number;
  insuranceExpense: number;
  repairsExpense: number;
  vehicleExpense: number;
  professionalFees: number;
  softwareExpense: number;
  taxesExpense: number;
  otherOpex: number;

  netOperatingIncome: number;
  otherIncome: number;
  otherExpense: number;
  netIncome: number;
  netMargin: number | null;

  cash: number | null;
  accountsReceivable: number | null;
  accountsPayable: number | null;
  inventoryValue: number | null;
  otherCurrentAssets: number | null;
  currentAssets: number | null;
  fixedAssets: number | null;
  totalAssets: number | null;
  creditCards: number | null;
  shortTermDebt: number | null;
  longTermDebt: number | null;
  currentLiabilities: number | null;
  totalLiabilities: number | null;
  equity: number | null;

  unmappedOpexAmount: number;
  unmappedOpexPct: number;
  balanceSheetBalanced: boolean | null;
  sourceSnapshotIds: string[];
  computedAt: string;
}

export interface LocationMetrics {
  period: Period;
  dimension: 'location' | 'class';
  dimensionQboId: string | null;
  dimensionName: string;
  netSales: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number | null;
  payrollExpense: number;
  advertisingExpense: number;
  rentExpense: number;
  operatingExpenses: number;
  contributionProfit: number;
  contributionMargin: number | null;
  /** false => shared/corporate overhead is NOT pushed down into this line. */
  overheadAllocated: boolean;
}

export interface VendorSpend {
  vendorQboId: string | null;
  vendorName: string;
  amount: number;
  txnCount: number;
}

export interface AgingBucket {
  entityName: string;
  entityQboId: string | null;
  current: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  days90Plus: number;
  total: number;
}

export interface AgingSnapshot {
  asOf: string;
  kind: 'receivable' | 'payable';
  total: AgingBucket;
  entities: AgingBucket[];
}

/** A change between two periods, with divide-by-zero handled explicitly. */
export interface Delta {
  current: number;
  previous: number | null;
  changeAmount: number | null;
  /** null means "not meaningful" -- render as N/M, never as a fake percentage. */
  changePct: number | null;
}

export interface KpiSet {
  revenueGrowthMoM: number | null;
  revenueGrowthYoY: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  operatingExpenseRatio: number | null;
  payrollPctRevenue: number | null;
  advertisingPctRevenue: number | null;
  rentPctRevenue: number | null;
  deliveryPctRevenue: number | null;
  merchantFeesPctRevenue: number | null;
  arPctRevenue: number | null;
  apPctRevenue: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  workingCapital: number | null;
  daysSalesOutstanding: number | null;
  daysPayableOutstanding: number | null;
  daysInventoryOutstanding: number | null;
  cashConversionCycle: number | null;
  averageMonthlyRevenue: number | null;
  trailing3Revenue: number | null;
  trailing6Revenue: number | null;
  trailing12Revenue: number | null;
  rollingGrossMargin: number | null;
  rollingNetMargin: number | null;
}

export type Severity = 'INFO' | 'WATCH' | 'IMPORTANT' | 'CRITICAL';

export interface Anomaly {
  ruleKey: string;
  severity: Severity;
  category: string;
  title: string;
  detail: string;
  metricKey: string | null;
  currentValue: number | null;
  comparisonValue: number | null;
  deltaAmount: number | null;
  deltaPct: number | null;
  score: number;
  evidence: Record<string, unknown>;
}

export interface AiInsight {
  category: string;
  severity: Severity;
  observation: string;
  supportingMetrics: string[];
  likelyImplication: string;
  recommendedAction: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface FlaggedTransaction {
  id: string;
  qboId: string;
  txnType: string;
  txnDate: string;
  docNumber: string | null;
  entityName: string | null;
  memo: string | null;
  amount: number;
  accountName: string | null;
  locationName: string | null;
  reasons: string[];
  severity: Severity;
  score: number;
}
