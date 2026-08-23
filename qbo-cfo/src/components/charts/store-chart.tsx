'use client';

import * as React from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartFrame } from './chart-frame';
import { ChartTooltip, compactCurrency, formatValue, percentTick, type ValueFormat } from './tooltip';
import { AXIS_COLOR, GRID_COLOR, SERIES, SURFACE } from './palette';

/** Grouped bars comparing stores on one measure family (never dual-axis). */
export function StoreComparisonChart({
  title,
  description,
  data,
  series,
  valueFormat = 'currency',
  height = 260,
}: {
  title: string;
  description?: string;
  data: Array<Record<string, string | number | null>>;
  series: Array<{ key: string; label: string; color: string }>;
  valueFormat?: ValueFormat;
  height?: number;
}) {
  return (
    <ChartFrame
      title={title}
      description={description}
      height={height}
      legend={series.map((s) => ({ label: s.label, color: s.color }))}
      table={{
        headers: ['Store', ...series.map((s) => s.label)],
        rows: data.map((d) => [
          String(d['label'] ?? ''),
          ...series.map((s) => formatValue(d[s.key] as number, valueFormat)),
        ]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: AXIS_COLOR }}
            tickLine={false}
            axisLine={{ stroke: GRID_COLOR }}
            interval={0}
            height={44}
            // Long store names collide at this width; truncate rather than
            // silently dropping ticks, and keep the full name in the tooltip.
            tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)}
          />
          <YAxis
            tick={{ fontSize: 11, fill: AXIS_COLOR }}
            tickLine={false}
            axisLine={false}
            width={62}
            tickFormatter={(v: number) => (valueFormat === 'percent' ? percentTick(v) : compactCurrency(v))}
          />
          <Tooltip
            content={<ChartTooltip formats={Object.fromEntries(series.map((s) => [s.key, valueFormat]))} />}
            cursor={{ fill: 'rgba(42,120,214,0.06)' }}
          />
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={s.color}
              radius={[4, 4, 0, 0]}
              maxBarSize={34}
              stroke={SURFACE}
              strokeWidth={2}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export { SERIES };
