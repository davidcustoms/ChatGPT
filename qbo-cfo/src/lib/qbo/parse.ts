import type {
  FlatReport,
  FlatRow,
  QboColData,
  QboReport,
  QboRow,
  SummaryRow,
} from './report-types';

/**
 * Generic QuickBooks report flattener.
 *
 * QuickBooks reports are a nested tree of Section/Data rows. Rather than
 * matching on English section labels (which vary by company and locale) we
 * flatten to (account id, label, values, group) tuples and let the analysis
 * layer classify by the account's *type*, which is stable across companies.
 */

export function parseAmount(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === '') return null;
  // QuickBooks emits negatives either as -123.45 or (123.45)
  const negativeParen = /^\((.*)\)$/.exec(trimmed);
  const body = (negativeParen ? negativeParen[1] : trimmed) ?? '';
  const cleaned = body.replace(/[$,\s]/g, '');
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return negativeParen ? -value : value;
}

function colDataValues(cols: QboColData[] | undefined): Array<number | null> {
  if (!cols) return [];
  return cols.slice(1).map((c) => parseAmount(c.value));
}

function colDataLabel(cols: QboColData[] | undefined): string {
  return cols?.[0]?.value?.trim() ?? '';
}

function colDataId(cols: QboColData[] | undefined): string | null {
  const id = cols?.[0]?.id;
  return id && id.trim() !== '' ? id : null;
}

export function flattenReport(report: QboReport): FlatReport {
  const rows: FlatRow[] = [];
  const summaries: SummaryRow[] = [];

  const columns = (report.Columns?.Column ?? []).slice(1).map((c) => ({
    title: c.ColTitle?.trim() ?? '',
    type: c.ColType ?? null,
    metaId:
      c.MetaData?.find((m) => m.Name === 'ID' || m.Name === 'DepartmentRef' || m.Name === 'ClassRef')
        ?.Value ?? null,
  }));

  const walk = (row: QboRow, path: string[]): void => {
    const headerLabel = colDataLabel(row.Header?.ColData);
    const nextPath = headerLabel ? [...path, headerLabel] : path;

    // Leaf data row
    if (row.ColData && !row.Rows) {
      const label = colDataLabel(row.ColData);
      if (label !== '') {
        rows.push({
          id: colDataId(row.ColData),
          label,
          values: colDataValues(row.ColData),
          path,
          group: row.group ?? null,
        });
      }
      return;
    }

    // A header row that also carries values (rare, but QuickBooks does it for
    // accounts that have both a balance and children).
    if (row.Header?.ColData && (row.Header.ColData.length ?? 0) > 1) {
      const values = colDataValues(row.Header.ColData);
      if (values.some((v) => v !== null)) {
        rows.push({
          id: colDataId(row.Header.ColData),
          label: headerLabel,
          values,
          path,
          group: row.group ?? null,
        });
      }
    }

    for (const child of row.Rows?.Row ?? []) walk(child, nextPath);

    if (row.Summary?.ColData) {
      summaries.push({
        group: row.group ?? null,
        label: colDataLabel(row.Summary.ColData),
        values: colDataValues(row.Summary.ColData),
        path: nextPath,
      });
    }
  };

  for (const row of report.Rows?.Row ?? []) walk(row, []);

  return {
    reportName: report.Header?.ReportName ?? 'Unknown',
    startPeriod: report.Header?.StartPeriod ?? null,
    endPeriod: report.Header?.EndPeriod ?? null,
    currency: report.Header?.Currency ?? null,
    columns,
    rows,
    summaries,
  };
}

/** First value of the summary row whose `group` matches, if present. */
export function summaryByGroup(flat: FlatReport, group: string, columnIndex = 0): number | null {
  const found = flat.summaries.find((s) => s.group === group);
  if (!found) return null;
  return found.values[columnIndex] ?? null;
}

/** Fallback lookup by (case-insensitive) summary label. */
export function summaryByLabel(flat: FlatReport, label: string, columnIndex = 0): number | null {
  const target = label.toLowerCase();
  const found = flat.summaries.find((s) => s.label.toLowerCase() === target);
  if (!found) return null;
  return found.values[columnIndex] ?? null;
}

/** Index of the column whose title matches, or -1. */
export function columnIndexByTitle(flat: FlatReport, title: string): number {
  const target = title.trim().toLowerCase();
  return flat.columns.findIndex((c) => c.title.trim().toLowerCase() === target);
}

/** True when the report contains no numeric data at all. */
export function isEmptyReport(flat: FlatReport): boolean {
  return (
    flat.rows.every((r) => r.values.every((v) => v === null || v === 0)) &&
    flat.summaries.every((s) => s.values.every((v) => v === null || v === 0))
  );
}
