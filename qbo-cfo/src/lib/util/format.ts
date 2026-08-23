/**
 * Presentation helpers shared by the web UI, the PDF renderer and the Excel
 * exporter, so a number never renders three different ways.
 */

export const NOT_MEANINGFUL = 'N/M';

export function formatCurrency(
  value: number | null | undefined,
  opts: { currency?: string; decimals?: number; compact?: boolean } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const { currency = 'USD', decimals = 0, compact = false } = opts;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    notation: compact ? 'compact' : 'standard',
  }).format(value);
}

export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Formats a ratio (0.435) as a percentage string ("43.5%"). */
export function formatPercent(
  ratio: number | null | undefined,
  decimals = 1,
  opts: { signed?: boolean } = {},
): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return NOT_MEANINGFUL;
  const pct = ratio * 100;
  const body = `${Math.abs(pct).toFixed(decimals)}%`;
  if (opts.signed) return `${pct > 0 ? '+' : pct < 0 ? '-' : ''}${body}`;
  return `${pct < 0 ? '-' : ''}${body}`;
}

/** Percentage-point delta, e.g. margin moving 44.7% -> 43.6% is "-1.1 pts". */
export function formatPoints(delta: number | null | undefined, decimals = 1): string {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return NOT_MEANINGFUL;
  const pts = delta * 100;
  const sign = pts > 0 ? '+' : pts < 0 ? '-' : '';
  return `${sign}${Math.abs(pts).toFixed(decimals)} pts`;
}

export function formatSignedCurrency(value: number | null | undefined, currency = 'USD'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const body = formatCurrency(Math.abs(value), { currency });
  return `${value > 0 ? '+' : value < 0 ? '-' : ''}${body}`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const iso = typeof value === 'string' ? value : value.toISOString();
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '—';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return 'Never';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return 'Never';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return 'never';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return 'never';
  const diffMs = Date.now() - d.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(d.toISOString());
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
