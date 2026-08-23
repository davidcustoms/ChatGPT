/** Shape of the JSON QuickBooks returns for every /reports/* endpoint. */

export interface QboColData {
  value?: string;
  id?: string;
  href?: string;
}

export interface QboColumnMeta {
  Name?: string;
  Value?: string;
}

export interface QboColumn {
  ColTitle?: string;
  ColType?: string;
  MetaData?: QboColumnMeta[];
}

export interface QboRow {
  Header?: { ColData?: QboColData[] };
  Rows?: { Row?: QboRow[] };
  Summary?: { ColData?: QboColData[] };
  ColData?: QboColData[];
  type?: string;
  group?: string;
}

export interface QboReport {
  Header?: {
    ReportName?: string;
    StartPeriod?: string;
    EndPeriod?: string;
    Currency?: string;
    Time?: string;
    ReportBasis?: string;
    Option?: Array<{ Name?: string; Value?: string }>;
  };
  Columns?: { Column?: QboColumn[] };
  Rows?: { Row?: QboRow[] };
}

/** A leaf (account-level) row after flattening the nested report tree. */
export interface FlatRow {
  /** QuickBooks account/entity id when the row carries one. */
  id: string | null;
  label: string;
  /** One numeric value per non-label column, in column order. */
  values: Array<number | null>;
  /** Section headers above this row, outermost first. */
  path: string[];
  group: string | null;
}

/** A section subtotal row (QuickBooks `Summary`). */
export interface SummaryRow {
  group: string | null;
  label: string;
  values: Array<number | null>;
  path: string[];
}

export interface FlatReport {
  reportName: string;
  startPeriod: string | null;
  endPeriod: string | null;
  currency: string | null;
  /** Column titles excluding the leading label column. */
  columns: Array<{ title: string; type: string | null; metaId: string | null }>;
  rows: FlatRow[];
  summaries: SummaryRow[];
}
