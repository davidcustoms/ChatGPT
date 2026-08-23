import { num, numOrNull, query, withTransaction } from '../pool';
import type { AccountRecord } from '../../finance/types';

/** Mirrors of QuickBooks master data (accounts, vendors, customers, classes, locations, items). */

export interface AccountRow {
  qbo_id: string;
  name: string;
  fully_qualified_name: string | null;
  account_number: string | null;
  account_type: string | null;
  account_sub_type: string | null;
  classification: string | null;
  parent_qbo_id: string | null;
  is_active: boolean;
  current_balance: string | null;
}

function toAccount(row: AccountRow): AccountRecord {
  return {
    qboId: row.qbo_id,
    name: row.name,
    fullyQualifiedName: row.fully_qualified_name,
    accountNumber: row.account_number,
    accountType: row.account_type,
    accountSubType: row.account_sub_type,
    classification: row.classification,
    parentQboId: row.parent_qbo_id,
    isActive: row.is_active,
    currentBalance: numOrNull(row.current_balance),
  };
}

export async function listAccounts(companyId: string): Promise<AccountRecord[]> {
  const rows = await query<AccountRow>(
    'SELECT * FROM accounts WHERE company_id = $1 ORDER BY account_type, name',
    [companyId],
  );
  return rows.map(toAccount);
}

export async function accountIndex(companyId: string): Promise<Map<string, AccountRecord>> {
  const accounts = await listAccounts(companyId);
  return new Map(accounts.map((a) => [a.qboId, a]));
}

export async function upsertAccounts(companyId: string, accounts: AccountRecord[]): Promise<number> {
  if (accounts.length === 0) return 0;
  await withTransaction(async (client) => {
    for (const a of accounts) {
      await client.query(
        `INSERT INTO accounts (company_id, qbo_id, name, fully_qualified_name, account_number,
                               account_type, account_sub_type, classification, parent_qbo_id,
                               is_active, current_balance, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
         ON CONFLICT (company_id, qbo_id) DO UPDATE SET
           name = EXCLUDED.name,
           fully_qualified_name = EXCLUDED.fully_qualified_name,
           account_number = EXCLUDED.account_number,
           account_type = EXCLUDED.account_type,
           account_sub_type = EXCLUDED.account_sub_type,
           classification = EXCLUDED.classification,
           parent_qbo_id = EXCLUDED.parent_qbo_id,
           is_active = EXCLUDED.is_active,
           current_balance = EXCLUDED.current_balance,
           synced_at = now()`,
        [
          companyId,
          a.qboId,
          a.name,
          a.fullyQualifiedName,
          a.accountNumber,
          a.accountType,
          a.accountSubType,
          a.classification,
          a.parentQboId,
          a.isActive,
          a.currentBalance,
        ],
      );
    }
  });
  return accounts.length;
}

export interface NamedEntity {
  qboId: string;
  name: string;
  isActive?: boolean;
  balance?: number | null;
  email?: string | null;
}

async function upsertNamed(
  table: 'customers' | 'vendors',
  companyId: string,
  entities: NamedEntity[],
): Promise<number> {
  if (entities.length === 0) return 0;
  await withTransaction(async (client) => {
    for (const e of entities) {
      await client.query(
        `INSERT INTO ${table} (company_id, qbo_id, display_name, email, balance, is_active, synced_at)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,TRUE), now())
         ON CONFLICT (company_id, qbo_id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           email = EXCLUDED.email,
           balance = EXCLUDED.balance,
           is_active = EXCLUDED.is_active,
           synced_at = now()`,
        [companyId, e.qboId, e.name, e.email ?? null, e.balance ?? null, e.isActive ?? null],
      );
    }
  });
  return entities.length;
}

export const upsertCustomers = (companyId: string, e: NamedEntity[]) =>
  upsertNamed('customers', companyId, e);
export const upsertVendors = (companyId: string, e: NamedEntity[]) =>
  upsertNamed('vendors', companyId, e);

export async function upsertDimensions(
  table: 'classes' | 'locations',
  companyId: string,
  entities: Array<NamedEntity & { fullyQualifiedName?: string | null; parentQboId?: string | null }>,
): Promise<number> {
  if (entities.length === 0) return 0;
  await withTransaction(async (client) => {
    for (const e of entities) {
      await client.query(
        `INSERT INTO ${table} (company_id, qbo_id, name, fully_qualified_name, parent_qbo_id, is_active, synced_at)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,TRUE), now())
         ON CONFLICT (company_id, qbo_id) DO UPDATE SET
           name = EXCLUDED.name,
           fully_qualified_name = EXCLUDED.fully_qualified_name,
           parent_qbo_id = EXCLUDED.parent_qbo_id,
           is_active = EXCLUDED.is_active,
           synced_at = now()`,
        [
          companyId,
          e.qboId,
          e.name,
          e.fullyQualifiedName ?? e.name,
          e.parentQboId ?? null,
          e.isActive ?? null,
        ],
      );
    }
  });
  return entities.length;
}

export interface ItemRecord {
  qboId: string;
  name: string;
  sku?: string | null;
  itemType?: string | null;
  qtyOnHand?: number | null;
  unitPrice?: number | null;
  purchaseCost?: number | null;
  isActive?: boolean;
}

export async function upsertItems(companyId: string, items: ItemRecord[]): Promise<number> {
  if (items.length === 0) return 0;
  await withTransaction(async (client) => {
    for (const i of items) {
      await client.query(
        `INSERT INTO items (company_id, qbo_id, name, sku, item_type, qty_on_hand, unit_price, purchase_cost, is_active, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,TRUE), now())
         ON CONFLICT (company_id, qbo_id) DO UPDATE SET
           name = EXCLUDED.name, sku = EXCLUDED.sku, item_type = EXCLUDED.item_type,
           qty_on_hand = EXCLUDED.qty_on_hand, unit_price = EXCLUDED.unit_price,
           purchase_cost = EXCLUDED.purchase_cost, is_active = EXCLUDED.is_active, synced_at = now()`,
        [
          companyId,
          i.qboId,
          i.name,
          i.sku ?? null,
          i.itemType ?? null,
          i.qtyOnHand ?? null,
          i.unitPrice ?? null,
          i.purchaseCost ?? null,
          i.isActive ?? null,
        ],
      );
    }
  });
  return items.length;
}

export interface DimensionRow {
  qboId: string;
  name: string;
  fullyQualifiedName: string | null;
  isActive: boolean;
  isStore?: boolean;
  displayName?: string | null;
}

export async function listDimensions(
  table: 'classes' | 'locations',
  companyId: string,
): Promise<DimensionRow[]> {
  const rows = await query<{
    qbo_id: string;
    name: string;
    fully_qualified_name: string | null;
    is_active: boolean;
    is_store?: boolean;
    display_name?: string | null;
  }>(`SELECT * FROM ${table} WHERE company_id = $1 ORDER BY name`, [companyId]);
  return rows.map((r) => ({
    qboId: r.qbo_id,
    name: r.name,
    fullyQualifiedName: r.fully_qualified_name,
    isActive: r.is_active,
    isStore: r.is_store,
    displayName: r.display_name ?? null,
  }));
}

export async function updateLocationSettings(
  companyId: string,
  qboId: string,
  patch: { displayName?: string | null; isStore?: boolean },
): Promise<void> {
  await query(
    `UPDATE locations SET display_name = COALESCE($3, display_name), is_store = COALESCE($4, is_store)
      WHERE company_id = $1 AND qbo_id = $2`,
    [companyId, qboId, patch.displayName ?? null, patch.isStore ?? null],
  );
}

export async function listVendors(companyId: string): Promise<
  Array<{ qboId: string; name: string; balance: number; isActive: boolean }>
> {
  const rows = await query<{ qbo_id: string; display_name: string; balance: string | null; is_active: boolean }>(
    'SELECT qbo_id, display_name, balance, is_active FROM vendors WHERE company_id = $1 ORDER BY display_name',
    [companyId],
  );
  return rows.map((r) => ({
    qboId: r.qbo_id,
    name: r.display_name,
    balance: num(r.balance),
    isActive: r.is_active,
  }));
}

export async function listCustomers(companyId: string): Promise<
  Array<{ qboId: string; name: string; balance: number }>
> {
  const rows = await query<{ qbo_id: string; display_name: string; balance: string | null }>(
    'SELECT qbo_id, display_name, balance FROM customers WHERE company_id = $1 ORDER BY display_name',
    [companyId],
  );
  return rows.map((r) => ({ qboId: r.qbo_id, name: r.display_name, balance: num(r.balance) }));
}

/** Total inventory quantity/value where the company tracks inventory items. */
export async function inventorySummary(
  companyId: string,
): Promise<{ itemCount: number; totalQty: number; negativeQtyItems: string[] }> {
  const rows = await query<{ name: string; qty_on_hand: string | null }>(
    `SELECT name, qty_on_hand FROM items
      WHERE company_id = $1 AND item_type = 'Inventory' AND is_active`,
    [companyId],
  );
  const negatives = rows.filter((r) => num(r.qty_on_hand) < 0).map((r) => r.name);
  return {
    itemCount: rows.length,
    totalQty: rows.reduce((a, r) => a + num(r.qty_on_hand), 0),
    negativeQtyItems: negatives,
  };
}
