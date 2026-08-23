'use client';

import * as React from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartFrame } from './chart-frame';
import { ChartTooltip, compactCurrency, formatValue, percentTick, type ValueFormat } from './tooltip';
import { AXIS_COLOR, GRID_COLOR, ORDINAL_BLUE, SERIES, SURFACE } from './palette';

/**
 * Horizontal bar chart for ranked magnitudes (expense categories, store
 * revenue). One hue by default; an ordinal ramp when the categories are
 * ordered, as with aging buckets.
 */
export function CategoryBarChart({
  title,
  description,
  data,
  valueLabel,
  valueFormat = 'currency',
  ordinal = false,
  height,
  color = SERIES.primary,
}: {
  title: string;
  description?: string;
  data: Array<{ label: string; value: number }>;
  valueLabel: string;
  valueFormat?: ValueFormat;
  ordinal?: boolean;
  height?: number;
  color?: string;
}) {
  const chartHeight = height ?? Math.max(180, data.length * 30 + 40);

  return (
    <ChartFrame
      title={title}
      description={description}
      height={chartHeight}
      table={{
        headers: ['Category', valueLabel],
        rows: data.map((d) => [d.label, formatValue(d.value, valueFormat)]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: AXIS_COLOR }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => (valueFormat === 'percent' ? percentTick(v) : compactCurrency(v))}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fontSize: 11, fill: AXIS_COLOR }}
            tickLine={false}
            axisLine={{ stroke: GRID_COLOR }}
            width={150}
            interval={0}
            tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)}
          />
          <Tooltip
            content={<ChartTooltip formats={{ value: valueFormat }} />}
            cursor={{ fill: 'rgba(42,120,214,0.06)' }}
          />
          <Bar dataKey="value" name={valueLabel} radius={[0, 4, 4, 0]} maxBarSize={20} stroke={SURFACE} strokeWidth={2}>
            {data.map((_, index) => (
              <Cell
                key={index}
                fill={ordinal ? (ORDINAL_BLUE[Math.min(index, ORDINAL_BLUE.length - 1)] as string) : color}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
