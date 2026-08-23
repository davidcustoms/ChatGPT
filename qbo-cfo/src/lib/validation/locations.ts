import { listDimensions } from '../db/repositories/masterdata';
import { getLocationMetrics } from '../db/repositories/metrics';
import { listTransactions } from '../db/repositories/transactions';
import { round2 } from '../finance/math';
import { formatCurrency, formatPercent } from '../util/format';
import type { Period } from '../util/dates';
import {
  needsReview,
  notAvailable,
  pass,
  fail,
  type ValidationSection,
  type ValidationCheck,
  type ValidationTable,
} from './types';

/**
 * Item 9: how this company actually represents its stores.
 *
 * A QuickBooks Location is not necessarily a store. Companies use Locations
 * for departments, funds, legal entities, or nothing at all, and use Classes
 * for the thing this application calls a store — or the reverse, or neither.
 *
 * So nothing here assumes. It shows what is there, how much money moved
 * through each one, and asks the owner to confirm. Until they do, store
 * analysis is labelled provisional, because a store comparison built on the
 * wrong dimension is a confident answer to the wrong question.
 */

export interface LocationValidationResult {
  section: ValidationSection;
  /** True once the owner has confirmed which dimension means "store". */
  storeMappingConfirmed: boolean;
  dimensionInUse: 'location' | 'class' | 'none';
}

export async function validateLocations(input: {
  companyId: string;
  period: Period;
  /** What the company settings say to use. 'auto' means nobody has chosen. */
  trackingDimension: 'auto' | 'location' | 'class' | 'none';
}): Promise<LocationValidationResult> {
  const { companyId, period } = input;
  const checks: ValidationCheck[] = [];

  const [locations, classes, storeMetrics, transactions] = await Promise.all([
    listDimensions('locations', companyId),
    listDimensions('classes', companyId),
    getLocationMetrics(companyId, period),
    listTransactions(companyId, period, 5_000),
  ]);

  const hasLocations = locations.length > 0;
  const hasClasses = classes.length > 0;

  if (!hasLocations && !hasClasses) {
    checks.push(
      notAvailable('locations_present', 'Stores', 'Locations and Classes',
        'This QuickBooks company uses neither Locations nor Classes. Store-level reporting is not possible, and the report says so rather than inventing a breakdown.'),
    );
    return {
      section: { key: 'locations', title: 'Location / store validation', checks },
      storeMappingConfirmed: true,
      dimensionInUse: 'none',
    };
  }

  // --- What is actually there ---------------------------------------------
  const countByLocation = new Map<string, { count: number; revenue: number }>();
  const countByClass = new Map<string, { count: number; revenue: number }>();
  for (const txn of transactions) {
    if (txn.locationQboId) {
      const entry = countByLocation.get(txn.locationQboId) ?? { count: 0, revenue: 0 };
      entry.count += 1;
      entry.revenue = round2(entry.revenue + txn.amount);
      countByLocation.set(txn.locationQboId, entry);
    }
    if (txn.classQboId) {
      const entry = countByClass.get(txn.classQboId) ?? { count: 0, revenue: 0 };
      entry.count += 1;
      entry.revenue = round2(entry.revenue + txn.amount);
      countByClass.set(txn.classQboId, entry);
    }
  }

  const revenueByDimensionName = new Map(storeMetrics.map((s) => [s.dimensionName, s.netSales]));

  const table: ValidationTable = {
    title: 'QuickBooks dimensions in this company',
    columns: ['QuickBooks Name', 'Type', 'Transaction Count', 'Revenue (from report)', 'Potential Store Mapping'],
    rows: [],
    caption:
      'Transaction count is how many postings in this period carry that dimension. Revenue is what the dimension-split Profit & Loss reported for it, which is the figure the store analysis uses.',
  };

  for (const location of locations) {
    const activity = countByLocation.get(location.qboId) ?? { count: 0, revenue: 0 };
    const reported = revenueByDimensionName.get(location.displayName ?? location.name) ?? null;
    table.rows.push({
      cells: [
        location.displayName ?? location.name,
        'Location',
        String(activity.count),
        reported === null ? '—' : formatCurrency(reported, { decimals: 2 }),
        activity.count > 0 || reported !== null ? 'candidate store' : 'no activity this period',
      ],
      status: activity.count > 0 || reported !== null ? 'NEEDS_REVIEW' : 'NOT_AVAILABLE',
    });
  }

  for (const klass of classes) {
    const activity = countByClass.get(klass.qboId) ?? { count: 0, revenue: 0 };
    const reported = revenueByDimensionName.get(klass.displayName ?? klass.name) ?? null;
    table.rows.push({
      cells: [
        klass.displayName ?? klass.name,
        'Class',
        String(activity.count),
        reported === null ? '—' : formatCurrency(reported, { decimals: 2 }),
        activity.count > 0 || reported !== null ? 'candidate store' : 'no activity this period',
      ],
      status: activity.count > 0 || reported !== null ? 'NEEDS_REVIEW' : 'NOT_AVAILABLE',
    });
  }

  checks.push(
    pass('locations_present', 'Stores', 'Dimensions present',
      `${locations.length} Location(s) and ${classes.length} Class(es). ${countByLocation.size} Location(s) and ${countByClass.size} Class(es) carry transactions in this period.`),
  );

  // --- Coverage: how much money is unassigned? ----------------------------
  const dimension: 'location' | 'class' | 'none' =
    input.trackingDimension === 'auto'
      ? hasLocations
        ? 'location'
        : hasClasses
          ? 'class'
          : 'none'
      : input.trackingDimension;

  if (transactions.length === 0) {
    checks.push(
      notAvailable('locations_coverage', 'Stores', 'Dimension assignment',
        'No transactions imported for this period, so dimension coverage could not be measured.'),
    );
  } else {
    const assigned = transactions.filter((t) =>
      dimension === 'location' ? t.locationQboId !== null : dimension === 'class' ? t.classQboId !== null : false,
    ).length;
    const share = assigned / transactions.length;
    checks.push(
      dimension === 'none'
        ? notAvailable('locations_coverage', 'Stores', 'Dimension assignment',
            'No dimension is selected for store reporting.')
        : share >= 0.95
          ? pass('locations_coverage', 'Stores', 'Dimension assignment',
              `${formatPercent(share)} of transactions carry a ${dimension}. Store figures cover essentially all activity.`)
          : needsReview('locations_coverage', 'Stores', 'Dimension assignment',
              `Only ${formatPercent(share)} of transactions carry a ${dimension}; ${transactions.length - assigned} posting(s) would be missing from any store breakdown.`,
              `Either assign the missing ${dimension}s in QuickBooks, or accept that store figures exclude them. The report states the coverage either way.`),
    );
  }

  // --- Has a human confirmed what a store is? -----------------------------
  const confirmed = input.trackingDimension === 'location' || input.trackingDimension === 'class' || input.trackingDimension === 'none';
  checks.push(
    confirmed
      ? pass('locations_confirmed', 'Stores', 'Store mapping confirmed',
          `Settings say to treat ${input.trackingDimension === 'none' ? 'nothing' : `each QuickBooks ${input.trackingDimension}`} as a store. Store analysis is reported as final.`)
      : needsReview('locations_confirmed', 'Stores', 'Store mapping confirmed',
          `Nobody has confirmed which QuickBooks dimension means "store"; the application would fall back to ${dimension}. A Location is not necessarily a store — companies also use them for departments, funds and legal entities.`,
          'Choose the dimension in Settings → Locations. Until then store analysis is provisional and is labelled as such.'),
  );

  // --- Does the store split reconcile to the company total? ---------------
  if (storeMetrics.length === 0) {
    checks.push(
      notAvailable('locations_reconcile', 'Stores', 'Store split',
        'QuickBooks returned no dimension-split Profit & Loss for this period, so there is no store breakdown to check.'),
    );
  } else {
    const storeTotal = round2(storeMetrics.reduce((a, s) => a + s.netSales, 0));
    checks.push(
      pass('locations_reconcile', 'Stores', 'Store split',
        `${storeMetrics.length} store line(s) summing to ${formatCurrency(storeTotal, { decimals: 2 })} of revenue. Store figures are contribution before corporate overhead; shared costs are not allocated.`),
    );
  }

  return {
    section: {
      key: 'locations',
      title: 'Location / store validation',
      checks,
      tables: [table],
      note: confirmed
        ? undefined
        : 'PROVISIONAL — no one has confirmed which QuickBooks dimension represents a store. Store analysis below should not be acted on until that is set in Settings → Locations.',
    },
    storeMappingConfirmed: confirmed,
    dimensionInUse: dimension,
  };
}
