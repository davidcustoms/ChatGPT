'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Shared chart chrome: title, optional description, legend and an accessible
 * data table that can be revealed. The table is the "relief" that keeps the
 * chart readable for colour-vision-deficient and print users.
 */
export function ChartFrame({
  title,
  description,
  legend,
  children,
  table,
  className,
  height = 260,
}: {
  title: string;
  description?: string;
  legend?: Array<{ label: string; color: string }>;
  children: React.ReactNode;
  table?: { headers: string[]; rows: Array<Array<string | number>> };
  className?: string;
  height?: number;
}) {
  const [showTable, setShowTable] = React.useState(false);
  const tableId = React.useId();

  return (
    <figure className={cn('m-0', className)}>
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {description ? <p className="text-xs text-ink-muted">{description}</p> : null}
        </div>
        {legend && legend.length > 1 ? (
          <ul className="flex flex-wrap items-center gap-3">
            {legend.map((item) => (
              <li key={item.label} className="flex items-center gap-1.5 text-xs text-ink-muted">
                <span
                  aria-hidden="true"
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: item.color }}
                />
                {item.label}
              </li>
            ))}
          </ul>
        ) : null}
      </figcaption>
      <div style={{ height }} className="w-full">
        {children}
      </div>
      {table ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-expanded={showTable}
            aria-controls={tableId}
            className="text-xs font-medium text-navy-700 underline-offset-2 hover:underline"
          >
            {showTable ? 'Hide data table' : 'Show data table'}
          </button>
          <div id={tableId} hidden={!showTable} className="mt-2 overflow-x-auto scrollbar-thin">
            <table className="w-full text-xs tnum">
              <caption className="sr-only">{title} — underlying values</caption>
              <thead>
                <tr className="border-b border-border">
                  {table.headers.map((h) => (
                    <th key={h} scope="col" className="px-2 py-1 text-left font-semibold text-ink-subtle">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i} className="border-b border-border/60">
                    {row.map((cell, j) => (
                      <td key={j} className={cn('px-2 py-1', j > 0 && 'text-right')}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </figure>
  );
}
