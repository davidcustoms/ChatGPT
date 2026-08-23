import type { AccountRecord } from '../finance/types';

/**
 * Synthetic chart of accounts for the demo furniture retailer.
 * Names deliberately differ from the management category labels so the
 * mapping engine has real work to do (e.g. "Meta Ads" -> Advertising).
 */

interface Seed {
  id: string;
  name: string;
  type: string;
  subType?: string;
  classification: string;
}

const SEEDS: Seed[] = [
  // Income
  { id: '4000', name: 'Furniture Sales', type: 'Income', subType: 'SalesOfProductIncome', classification: 'Revenue' },
  { id: '4010', name: 'Mattress Sales', type: 'Income', subType: 'SalesOfProductIncome', classification: 'Revenue' },
  { id: '4020', name: 'Accessories & Decor Sales', type: 'Income', subType: 'SalesOfProductIncome', classification: 'Revenue' },
  { id: '4030', name: 'Protection Plan Income', type: 'Income', subType: 'ServiceFeeIncome', classification: 'Revenue' },
  { id: '4040', name: 'Delivery Revenue', type: 'Income', subType: 'ServiceFeeIncome', classification: 'Revenue' },
  { id: '4900', name: 'Customer Discounts', type: 'Income', subType: 'DiscountsRefundsGiven', classification: 'Revenue' },
  { id: '4910', name: 'Sales Returns & Allowances', type: 'Income', subType: 'DiscountsRefundsGiven', classification: 'Revenue' },
  // COGS
  { id: '5000', name: 'Merchandise Cost', type: 'Cost of Goods Sold', subType: 'SuppliesMaterialsCogs', classification: 'Expense' },
  { id: '5010', name: 'Inbound Freight', type: 'Cost of Goods Sold', subType: 'ShippingFreightDeliveryCos', classification: 'Expense' },
  { id: '5020', name: 'Inventory Adjustments', type: 'Cost of Goods Sold', subType: 'SuppliesMaterialsCogs', classification: 'Expense' },
  // Operating expenses
  { id: '6000', name: 'Sales Floor Payroll', type: 'Expense', subType: 'PayrollWageExpenses', classification: 'Expense' },
  { id: '6005', name: 'Warehouse & Delivery Payroll', type: 'Expense', subType: 'PayrollWageExpenses', classification: 'Expense' },
  { id: '6010', name: 'Administrative Payroll', type: 'Expense', subType: 'PayrollWageExpenses', classification: 'Expense' },
  { id: '6020', name: 'Payroll Taxes', type: 'Expense', subType: 'PayrollTaxExpenses', classification: 'Expense' },
  { id: '6030', name: 'Sales Commissions', type: 'Expense', subType: 'PayrollWageExpenses', classification: 'Expense' },
  { id: '6100', name: 'Meta Ads', type: 'Expense', subType: 'AdvertisingPromotional', classification: 'Expense' },
  { id: '6110', name: 'Google Ads', type: 'Expense', subType: 'AdvertisingPromotional', classification: 'Expense' },
  { id: '6120', name: 'TikTok Ads', type: 'Expense', subType: 'AdvertisingPromotional', classification: 'Expense' },
  { id: '6130', name: 'Local Print & Radio', type: 'Expense', subType: 'AdvertisingPromotional', classification: 'Expense' },
  { id: '6200', name: 'Showroom Rent', type: 'Expense', subType: 'RentOrLeaseOfBuildings', classification: 'Expense' },
  { id: '6210', name: 'Common Area Maintenance', type: 'Expense', subType: 'RentOrLeaseOfBuildings', classification: 'Expense' },
  { id: '6300', name: 'Last Mile Delivery Contractors', type: 'Expense', classification: 'Expense' },
  { id: '6310', name: 'White Glove Installation', type: 'Expense', classification: 'Expense' },
  { id: '6400', name: 'Warehouse Storage', type: 'Expense', classification: 'Expense' },
  { id: '6500', name: 'Credit Card Processing Fees', type: 'Expense', classification: 'Expense' },
  { id: '6510', name: 'Consumer Financing Fees', type: 'Expense', classification: 'Expense' },
  { id: '6600', name: 'Utilities', type: 'Expense', subType: 'Utilities', classification: 'Expense' },
  { id: '6610', name: 'Telephone & Internet', type: 'Expense', subType: 'Utilities', classification: 'Expense' },
  { id: '6700', name: 'Business Insurance', type: 'Expense', subType: 'Insurance', classification: 'Expense' },
  { id: '6800', name: 'Repairs & Maintenance', type: 'Expense', subType: 'RepairMaintenance', classification: 'Expense' },
  { id: '6810', name: 'Janitorial', type: 'Expense', subType: 'RepairMaintenance', classification: 'Expense' },
  { id: '6900', name: 'Delivery Vehicle Fuel', type: 'Expense', subType: 'Auto', classification: 'Expense' },
  { id: '6910', name: 'Vehicle Repairs', type: 'Expense', subType: 'Auto', classification: 'Expense' },
  { id: '7000', name: 'Legal & Professional', type: 'Expense', subType: 'LegalProfessionalFees', classification: 'Expense' },
  { id: '7010', name: 'Bookkeeping & CPA', type: 'Expense', subType: 'LegalProfessionalFees', classification: 'Expense' },
  { id: '7100', name: 'Software Subscriptions', type: 'Expense', classification: 'Expense' },
  { id: '7200', name: 'Bank Service Charges', type: 'Expense', subType: 'BankCharges', classification: 'Expense' },
  { id: '7300', name: 'Business Licenses & Permits', type: 'Expense', subType: 'TaxesPaid', classification: 'Expense' },
  { id: '7400', name: 'Office Supplies', type: 'Expense', classification: 'Expense' },
  { id: '7900', name: 'Uncategorized Expense', type: 'Expense', classification: 'Expense' },
  // Other income / expense
  { id: '8000', name: 'Vendor Rebates', type: 'Other Income', subType: 'OtherMiscellaneousIncome', classification: 'Revenue' },
  { id: '8100', name: 'Interest Expense', type: 'Other Expense', subType: 'InterestPaid', classification: 'Expense' },
  { id: '8200', name: 'Depreciation', type: 'Other Expense', subType: 'Depreciation', classification: 'Expense' },
  // Balance sheet
  { id: '1000', name: 'Operating Checking', type: 'Bank', subType: 'Checking', classification: 'Asset' },
  { id: '1010', name: 'Payroll Checking', type: 'Bank', subType: 'Checking', classification: 'Asset' },
  { id: '1100', name: 'Accounts Receivable', type: 'Accounts Receivable', subType: 'AccountsReceivable', classification: 'Asset' },
  { id: '1200', name: 'Merchandise Inventory', type: 'Other Current Asset', subType: 'Inventory', classification: 'Asset' },
  { id: '1300', name: 'Prepaid Expenses', type: 'Other Current Asset', subType: 'PrepaidExpenses', classification: 'Asset' },
  { id: '1500', name: 'Leasehold Improvements', type: 'Fixed Asset', subType: 'LeaseholdImprovements', classification: 'Asset' },
  { id: '1510', name: 'Delivery Vehicles', type: 'Fixed Asset', subType: 'Vehicles', classification: 'Asset' },
  { id: '2000', name: 'Accounts Payable', type: 'Accounts Payable', subType: 'AccountsPayable', classification: 'Liability' },
  { id: '2100', name: 'Business Credit Card', type: 'Credit Card', subType: 'CreditCard', classification: 'Liability' },
  { id: '2200', name: 'Customer Deposits', type: 'Other Current Liability', subType: 'OtherCurrentLiabilities', classification: 'Liability' },
  { id: '2300', name: 'Floor Plan Line of Credit', type: 'Other Current Liability', subType: 'LineOfCredit', classification: 'Liability' },
  { id: '2500', name: 'Equipment Loan', type: 'Long Term Liability', subType: 'NotesPayable', classification: 'Liability' },
  { id: '3000', name: 'Owner Equity', type: 'Equity', subType: 'OwnersEquity', classification: 'Equity' },
  { id: '3100', name: 'Retained Earnings', type: 'Equity', subType: 'RetainedEarnings', classification: 'Equity' },
  { id: '3200', name: 'Owner Distributions', type: 'Equity', subType: 'OwnersEquity', classification: 'Equity' },
];

export const DEMO_ACCOUNTS: AccountRecord[] = SEEDS.map((s) => ({
  qboId: s.id,
  name: s.name,
  fullyQualifiedName: s.name,
  accountNumber: s.id,
  accountType: s.type,
  accountSubType: s.subType ?? null,
  classification: s.classification,
  parentQboId: null,
  isActive: true,
  currentBalance: null,
}));

export const DEMO_ACCOUNT_BY_ID = new Map(DEMO_ACCOUNTS.map((a) => [a.qboId, a]));

/**
 * Demo stores. `payrollBias` and `adBias` scale each store's share of payroll
 * and advertising away from its revenue share, and `growthBias` gives each
 * store its own trajectory, so store-level ratios and growth rates differ the
 * way they do in a real chain (an overstaffed store, a shrinking location, an
 * online channel that absorbs most of the ad budget).
 */
export const DEMO_STORES = [
  { qboId: '1', name: 'Riverside Showroom', share: 0.34, marginBias: 0.01, payrollBias: 0.92, adBias: 0.6, growthBias: 0.004 },
  { qboId: '2', name: 'Northgate Showroom', share: 0.28, marginBias: 0.0, payrollBias: 1.05, adBias: 0.7, growthBias: 0.001 },
  { qboId: '3', name: 'Westport Showroom', share: 0.23, marginBias: -0.015, payrollBias: 1.22, adBias: 0.75, growthBias: -0.006 },
  { qboId: '4', name: 'Online & Clearance', share: 0.15, marginBias: -0.03, payrollBias: 0.62, adBias: 2.6, growthBias: 0.013 },
];

export const DEMO_VENDORS = [
  'Ashley Furniture Industries', 'Coaster Fine Furniture', 'Sealy Mattress Co',
  'Tempur-Sealy Distribution', 'Modway Imports', 'Regional Freight Lines',
  'Metro Last Mile Delivery', 'Riverside Property Group', 'Northgate Retail Partners',
  'Westport Commercial Realty', 'Meta Platforms', 'Google LLC', 'TikTok Ads',
  'Clover Payment Systems', 'Synchrony Retail Finance', 'City Power & Light',
  'Guardian Business Insurance', 'Sparkle Janitorial Services', 'Fleet Fuel Card',
  'Harbor Legal Group', 'Ledgerline Bookkeeping', 'Shopify', 'Northstar Bank',
  'Summit Storage Solutions', 'BrightSign Digital Displays',
];

export const DEMO_CUSTOMERS = [
  'Walk-in Retail', 'Harborview Apartments', 'Sunrise Senior Living',
  'Copper Creek Builders', 'Lakeside Hotel Group', 'Maple Street Staging',
  'Pinecrest Property Management', 'Trailhead Interiors',
];
