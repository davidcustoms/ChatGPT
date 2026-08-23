/**
 * Management category taxonomy.
 *
 * The application never hard-codes QuickBooks account *names*. Instead every
 * QuickBooks account is mapped to one of these management categories, and all
 * downstream analysis (P&L rollups, KPIs, anomaly rules, AI context) reads
 * category keys only. Owners may add custom categories on top of these.
 */

export type CategorySection =
  | 'revenue'
  | 'contra_revenue'
  | 'cogs'
  | 'opex'
  | 'other_income'
  | 'other_expense'
  | 'balance_sheet'
  | 'ignore';

export interface CategoryDefinition {
  key: string;
  label: string;
  section: CategorySection;
  sortOrder: number;
  /** Lower-cased tokens used by the auto-suggestion engine. */
  keywords: string[];
  /** QuickBooks AccountSubType values that map here with high confidence. */
  subTypes?: string[];
  /** Metric column on monthly_metrics this category feeds, when applicable. */
  metricColumn?: string;
}

export const DEFAULT_CATEGORIES: CategoryDefinition[] = [
  {
    key: 'revenue',
    label: 'Revenue',
    section: 'revenue',
    sortOrder: 10,
    keywords: ['sales', 'revenue', 'income', 'merchandise', 'furniture sales', 'retail'],
    subTypes: ['SalesOfProductIncome', 'ServiceFeeIncome', 'OtherPrimaryIncome'],
  },
  {
    key: 'discounts',
    label: 'Discounts',
    section: 'contra_revenue',
    sortOrder: 20,
    keywords: ['discount', 'markdown', 'promo', 'promotion', 'allowance'],
    subTypes: ['DiscountsRefundsGiven'],
    metricColumn: 'discounts',
  },
  {
    key: 'returns',
    label: 'Returns',
    section: 'contra_revenue',
    sortOrder: 30,
    keywords: ['return', 'refund', 'credit memo', 'rma', 'restocking'],
    metricColumn: 'refunds',
  },
  {
    key: 'cogs',
    label: 'COGS',
    section: 'cogs',
    sortOrder: 40,
    keywords: [
      'cost of goods', 'cogs', 'cost of sales', 'purchases', 'inventory purchase',
      'merchandise cost', 'product cost',
    ],
    subTypes: ['SuppliesMaterialsCogs', 'CostOfLaborCos', 'ShippingFreightDeliveryCos', 'OtherCostsOfServiceCos'],
    metricColumn: 'cogs',
  },
  {
    key: 'freight',
    label: 'Freight',
    section: 'cogs',
    sortOrder: 45,
    keywords: ['freight', 'inbound shipping', 'shipping in', 'carrier', 'ltl'],
    metricColumn: 'freight_expense',
  },
  {
    key: 'payroll',
    label: 'Payroll',
    section: 'opex',
    sortOrder: 50,
    keywords: [
      'payroll', 'wages', 'salary', 'salaries', 'labor', 'commission',
      'employee benefit', 'payroll tax', 'workers comp', 'contractor',
    ],
    subTypes: ['PayrollExpenses', 'PayrollTaxExpenses', 'PayrollWageExpenses'],
    metricColumn: 'payroll_expense',
  },
  {
    key: 'advertising',
    label: 'Advertising',
    section: 'opex',
    sortOrder: 60,
    keywords: [
      'advertis', 'marketing', 'facebook', 'meta ads', 'google ads', 'adwords',
      'tiktok', 'instagram', 'promotion', 'media buy', 'seo', 'ppc', 'billboard', 'radio',
    ],
    subTypes: ['AdvertisingPromotional'],
    metricColumn: 'advertising_expense',
  },
  {
    key: 'rent',
    label: 'Rent',
    section: 'opex',
    sortOrder: 70,
    keywords: ['rent', 'lease', 'occupancy', 'cam charge', 'common area'],
    subTypes: ['RentOrLeaseOfBuildings'],
    metricColumn: 'rent_expense',
  },
  {
    key: 'delivery',
    label: 'Delivery',
    section: 'opex',
    sortOrder: 80,
    keywords: ['delivery', 'last mile', 'white glove', 'installation', 'outbound shipping'],
    metricColumn: 'delivery_expense',
  },
  {
    key: 'warehouse',
    label: 'Warehouse',
    section: 'opex',
    sortOrder: 90,
    keywords: ['warehouse', 'storage', 'fulfillment', 'distribution center', '3pl'],
    metricColumn: 'warehouse_expense',
  },
  {
    key: 'merchant_processing',
    label: 'Merchant Processing',
    section: 'opex',
    sortOrder: 100,
    keywords: [
      'merchant', 'credit card fee', 'card processing', 'stripe', 'square',
      'clover', 'interchange', 'payment processing',
    ],
    metricColumn: 'merchant_fees',
  },
  {
    key: 'financing_fees',
    label: 'Financing Fees',
    section: 'opex',
    sortOrder: 110,
    keywords: [
      'financing fee', 'consumer financing', 'synchrony', 'wells fargo financing',
      'affirm', 'katapult', 'progressive leasing', 'lease to own', 'dealer fee',
    ],
    metricColumn: 'financing_fees',
  },
  {
    key: 'utilities',
    label: 'Utilities',
    section: 'opex',
    sortOrder: 120,
    keywords: ['utilit', 'electric', 'gas bill', 'water', 'internet', 'telephone', 'phone', 'trash'],
    subTypes: ['Utilities'],
    metricColumn: 'utilities_expense',
  },
  {
    key: 'insurance',
    label: 'Insurance',
    section: 'opex',
    sortOrder: 130,
    keywords: ['insurance', 'liability coverage', 'workers compensation insurance'],
    subTypes: ['Insurance'],
    metricColumn: 'insurance_expense',
  },
  {
    key: 'repairs',
    label: 'Repairs',
    section: 'opex',
    sortOrder: 140,
    keywords: ['repair', 'maintenance', 'janitorial', 'cleaning', 'landscap'],
    subTypes: ['RepairMaintenance'],
    metricColumn: 'repairs_expense',
  },
  {
    key: 'vehicles',
    label: 'Vehicles',
    section: 'opex',
    sortOrder: 150,
    keywords: ['vehicle', 'auto', 'truck', 'fuel', 'mileage', 'fleet'],
    subTypes: ['Auto', 'Vehicle'],
    metricColumn: 'vehicle_expense',
  },
  {
    key: 'professional_fees',
    label: 'Professional Fees',
    section: 'opex',
    sortOrder: 160,
    keywords: ['professional', 'legal', 'attorney', 'accounting', 'cpa', 'bookkeep', 'consulting'],
    subTypes: ['LegalProfessionalFees'],
    metricColumn: 'professional_fees',
  },
  {
    key: 'software',
    label: 'Software',
    section: 'opex',
    sortOrder: 170,
    keywords: ['software', 'saas', 'subscription', 'hosting', 'license', 'app fee'],
    metricColumn: 'software_expense',
  },
  {
    key: 'bank_fees',
    label: 'Bank Fees',
    section: 'opex',
    sortOrder: 180,
    keywords: ['bank fee', 'bank charge', 'service charge', 'wire fee', 'nsf'],
    subTypes: ['BankCharges'],
    metricColumn: 'bank_fees',
  },
  {
    key: 'taxes',
    label: 'Taxes',
    section: 'opex',
    sortOrder: 190,
    keywords: ['tax', 'licenses', 'permits', 'franchise tax', 'property tax'],
    subTypes: ['TaxesPaid'],
    metricColumn: 'taxes_expense',
  },
  {
    key: 'other_opex',
    label: 'Other Operating Expense',
    section: 'opex',
    sortOrder: 900,
    keywords: ['other', 'miscellaneous', 'general'],
    metricColumn: 'other_opex',
  },
  {
    key: 'interest',
    label: 'Interest',
    section: 'other_expense',
    sortOrder: 910,
    keywords: ['interest expense', 'interest paid', 'loan interest'],
    subTypes: ['InterestPaid'],
    metricColumn: 'interest_expense',
  },
  {
    key: 'other_income',
    label: 'Other Income',
    section: 'other_income',
    sortOrder: 920,
    keywords: ['other income', 'interest income', 'rebate', 'vendor rebate', 'coop'],
    subTypes: ['OtherMiscellaneousIncome', 'InterestEarned'],
  },
  {
    key: 'other_expense',
    label: 'Other Expense',
    section: 'other_expense',
    sortOrder: 930,
    keywords: ['other expense', 'depreciation', 'amortization', 'penalt'],
    subTypes: ['Depreciation', 'AmortizationExpense'],
  },
];

export const CATEGORY_BY_KEY: ReadonlyMap<string, CategoryDefinition> = new Map(
  DEFAULT_CATEGORIES.map((c) => [c.key, c]),
);

export function categoryLabel(key: string | null | undefined): string {
  if (!key) return 'Unmapped';
  return CATEGORY_BY_KEY.get(key)?.label ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function categorySection(key: string | null | undefined): CategorySection | null {
  if (!key) return null;
  return CATEGORY_BY_KEY.get(key)?.section ?? null;
}

/** Categories that roll into operating expenses on the management P&L. */
export const OPEX_CATEGORY_KEYS = DEFAULT_CATEGORIES.filter((c) => c.section === 'opex').map((c) => c.key);
