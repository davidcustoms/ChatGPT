import type { AccountRecord } from '../finance/types';
import type { QuickBooksClient } from './client';
import type { NamedEntity, ItemRecord } from '../db/repositories/masterdata';
import type { TransactionInput } from '../db/repositories/transactions';

/** Raw shapes of the QuickBooks entities this application reads. */

interface QboRef {
  value?: string;
  name?: string;
}

interface QboAccount {
  Id?: string;
  Name?: string;
  FullyQualifiedName?: string;
  AcctNum?: string;
  AccountType?: string;
  AccountSubType?: string;
  Classification?: string;
  ParentRef?: QboRef;
  Active?: boolean;
  CurrentBalance?: number;
  CurrencyRef?: QboRef;
}

interface QboNamed {
  Id?: string;
  DisplayName?: string;
  Name?: string;
  FullyQualifiedName?: string;
  ParentRef?: QboRef;
  Active?: boolean;
  Balance?: number;
  PrimaryEmailAddr?: { Address?: string };
}

interface QboItem {
  Id?: string;
  Name?: string;
  Sku?: string;
  Type?: string;
  QtyOnHand?: number;
  UnitPrice?: number;
  PurchaseCost?: number;
  Active?: boolean;
}

interface QboLine {
  LineNum?: number;
  Description?: string;
  Amount?: number;
  DetailType?: string;
  AccountBasedExpenseLineDetail?: {
    AccountRef?: QboRef;
    ClassRef?: QboRef;
    CustomerRef?: QboRef;
  };
  SalesItemLineDetail?: {
    ItemRef?: QboRef;
    ClassRef?: QboRef;
    Qty?: number;
  };
  ItemBasedExpenseLineDetail?: {
    ItemRef?: QboRef;
    ClassRef?: QboRef;
    Qty?: number;
  };
  JournalEntryLineDetail?: {
    AccountRef?: QboRef;
    ClassRef?: QboRef;
    DepartmentRef?: QboRef;
    PostingType?: string;
  };
}

interface QboTransaction {
  Id?: string;
  TxnDate?: string;
  DocNumber?: string;
  PrivateNote?: string;
  TotalAmt?: number;
  VendorRef?: QboRef;
  CustomerRef?: QboRef;
  EmployeeRef?: QboRef;
  EntityRef?: QboRef;
  DepartmentRef?: QboRef;
  ClassRef?: QboRef;
  Line?: QboLine[];
  MetaData?: { LastUpdatedTime?: string };
}

export async function fetchCompanyInfo(client: QuickBooksClient, realmId: string): Promise<{
  companyName: string | null;
  legalName: string | null;
  country: string | null;
  fiscalYearStartMonth: number | null;
}> {
  const res = await client.request<{
    CompanyInfo?: {
      CompanyName?: string;
      LegalName?: string;
      Country?: string;
      CompanyAddr?: { Country?: string };
      FiscalYearStartMonth?: string;
    };
  }>(`companyinfo/${realmId}`);
  const info = res.CompanyInfo;
  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const monthIndex = info?.FiscalYearStartMonth
    ? MONTHS.findIndex((m) => m.toLowerCase() === info.FiscalYearStartMonth?.toLowerCase())
    : -1;
  return {
    companyName: info?.CompanyName ?? null,
    legalName: info?.LegalName ?? null,
    country: info?.Country ?? info?.CompanyAddr?.Country ?? null,
    fiscalYearStartMonth: monthIndex >= 0 ? monthIndex + 1 : null,
  };
}

export async function fetchAccounts(client: QuickBooksClient): Promise<AccountRecord[]> {
  const rows = await client.queryAll<QboAccount>('Account');
  return rows
    .filter((a) => a.Id && a.Name)
    .map((a) => ({
      qboId: a.Id as string,
      name: a.Name as string,
      fullyQualifiedName: a.FullyQualifiedName ?? a.Name ?? null,
      accountNumber: a.AcctNum ?? null,
      accountType: a.AccountType ?? null,
      accountSubType: a.AccountSubType ?? null,
      classification: a.Classification ?? null,
      parentQboId: a.ParentRef?.value ?? null,
      isActive: a.Active !== false,
      currentBalance: typeof a.CurrentBalance === 'number' ? a.CurrentBalance : null,
    }));
}

function toNamed(rows: QboNamed[]): NamedEntity[] {
  return rows
    .filter((r) => r.Id)
    .map((r) => ({
      qboId: r.Id as string,
      name: r.DisplayName ?? r.Name ?? r.FullyQualifiedName ?? `#${r.Id}`,
      isActive: r.Active !== false,
      balance: typeof r.Balance === 'number' ? r.Balance : null,
      email: r.PrimaryEmailAddr?.Address ?? null,
    }));
}

export async function fetchVendors(client: QuickBooksClient): Promise<NamedEntity[]> {
  return toNamed(await client.queryAll<QboNamed>('Vendor'));
}

export async function fetchCustomers(client: QuickBooksClient): Promise<NamedEntity[]> {
  return toNamed(await client.queryAll<QboNamed>('Customer'));
}

export async function fetchClasses(
  client: QuickBooksClient,
): Promise<Array<NamedEntity & { fullyQualifiedName: string | null; parentQboId: string | null }>> {
  const rows = await client.queryAll<QboNamed>('Class');
  return rows
    .filter((r) => r.Id)
    .map((r) => ({
      qboId: r.Id as string,
      name: r.Name ?? r.FullyQualifiedName ?? `#${r.Id}`,
      fullyQualifiedName: r.FullyQualifiedName ?? r.Name ?? null,
      parentQboId: r.ParentRef?.value ?? null,
      isActive: r.Active !== false,
    }));
}

export async function fetchLocations(
  client: QuickBooksClient,
): Promise<Array<NamedEntity & { fullyQualifiedName: string | null; parentQboId: string | null }>> {
  // "Department" is the API name for what the QuickBooks UI calls Location.
  const rows = await client.queryAll<QboNamed>('Department');
  return rows
    .filter((r) => r.Id)
    .map((r) => ({
      qboId: r.Id as string,
      name: r.Name ?? r.FullyQualifiedName ?? `#${r.Id}`,
      fullyQualifiedName: r.FullyQualifiedName ?? r.Name ?? null,
      parentQboId: r.ParentRef?.value ?? null,
      isActive: r.Active !== false,
    }));
}

export async function fetchItems(client: QuickBooksClient): Promise<ItemRecord[]> {
  const rows = await client.queryAll<QboItem>('Item');
  return rows
    .filter((i) => i.Id && i.Name)
    .map((i) => ({
      qboId: i.Id as string,
      name: i.Name as string,
      sku: i.Sku ?? null,
      itemType: i.Type ?? null,
      qtyOnHand: typeof i.QtyOnHand === 'number' ? i.QtyOnHand : null,
      unitPrice: typeof i.UnitPrice === 'number' ? i.UnitPrice : null,
      purchaseCost: typeof i.PurchaseCost === 'number' ? i.PurchaseCost : null,
      isActive: i.Active !== false,
    }));
}

/** Transaction entity types pulled for vendor spend and large-transaction review. */
export const TRANSACTION_ENTITIES = [
  'Purchase',
  'Bill',
  'BillPayment',
  'JournalEntry',
  'Invoice',
  'CreditMemo',
  'RefundReceipt',
  'SalesReceipt',
  'Deposit',
  'VendorCredit',
] as const;

export type TransactionEntity = (typeof TRANSACTION_ENTITIES)[number];

function entityRef(txn: QboTransaction): { type: string | null; ref: QboRef | undefined } {
  if (txn.VendorRef) return { type: 'Vendor', ref: txn.VendorRef };
  if (txn.CustomerRef) return { type: 'Customer', ref: txn.CustomerRef };
  if (txn.EmployeeRef) return { type: 'Employee', ref: txn.EmployeeRef };
  if (txn.EntityRef) return { type: 'Entity', ref: txn.EntityRef };
  return { type: null, ref: undefined };
}

export async function fetchTransactions(
  client: QuickBooksClient,
  entity: TransactionEntity,
  startDate: string,
  endDate: string,
): Promise<TransactionInput[]> {
  const rows = await client.queryAll<QboTransaction>(
    entity,
    `TxnDate >= '${startDate}' AND TxnDate <= '${endDate}'`,
  );
  return rows
    .filter((t) => t.Id)
    .map((t) => {
      const { type, ref } = entityRef(t);
      return {
        qboId: t.Id as string,
        txnType: entity,
        txnDate: t.TxnDate ?? startDate,
        docNumber: t.DocNumber ?? null,
        entityType: type,
        entityQboId: ref?.value ?? null,
        entityName: ref?.name ?? null,
        memo: t.PrivateNote ?? null,
        totalAmount: typeof t.TotalAmt === 'number' ? t.TotalAmt : 0,
        locationQboId: t.DepartmentRef?.value ?? null,
        classQboId: t.ClassRef?.value ?? null,
        lines: (t.Line ?? [])
          .filter((l) => typeof l.Amount === 'number')
          .map((l) => {
            const accountRef =
              l.AccountBasedExpenseLineDetail?.AccountRef ?? l.JournalEntryLineDetail?.AccountRef;
            const classRef =
              l.AccountBasedExpenseLineDetail?.ClassRef ??
              l.SalesItemLineDetail?.ClassRef ??
              l.ItemBasedExpenseLineDetail?.ClassRef ??
              l.JournalEntryLineDetail?.ClassRef;
            return {
              lineNum: l.LineNum ?? null,
              description: l.Description ?? null,
              amount: l.Amount as number,
              accountQboId: accountRef?.value ?? null,
              accountName: accountRef?.name ?? null,
              itemQboId:
                l.SalesItemLineDetail?.ItemRef?.value ??
                l.ItemBasedExpenseLineDetail?.ItemRef?.value ??
                null,
              classQboId: classRef?.value ?? null,
              locationQboId: l.JournalEntryLineDetail?.DepartmentRef?.value ?? t.DepartmentRef?.value ?? null,
              customerQboId: l.AccountBasedExpenseLineDetail?.CustomerRef?.value ?? null,
              quantity: l.SalesItemLineDetail?.Qty ?? l.ItemBasedExpenseLineDetail?.Qty ?? null,
              detailType: l.DetailType ?? null,
            };
          }),
      };
    });
}
