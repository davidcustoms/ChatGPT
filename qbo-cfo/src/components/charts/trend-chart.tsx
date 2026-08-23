'use client';

import * as React from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartFrame } from './chart-frame';
import { ChartTooltip, compactCurrency, formatValue, percentTick, type ValueFormat } from './tooltip';
import { AXIS_COLOR, GRID_COLOR, SERIES, SURFACE } from './palette';

export interface SeriesSpec {
  key: string;
  label: string;
  color: string;
  type?: 'line' | 'bar' | 'area';
  format?: ValueFormat;
}

/**
 * Multi-series trend chart.
 *
 * Deliberately single-axis: two measures on different scales are shown as two
 * charts rather than a dual-axis chart, which misleads by construction.
 */
export function TrendChart({
  title,
  description,
  data,
  series,
  height = 260,
  valueFormat = 'currency',
  showTable = true,
}: {
  title: string;
  description?: string;
  data: Array<Record<string, number | string | null>>;
  series: SeriesSpec[];
  height?: number;
  valueFormat?: ValueFormat;
  showTable?: boolean;
}) {
  const formats = Object.fromEntries(series.map((s) => [s.key, s.format ?? valueFormat]));

  return (
    <ChartFrame
      title={title}
      description={description}
      height={height}
      legend={series.map((s) => ({ label: s.label, color: s.color }))}
      table={
        showTable
          ? {
              headers: ['Month', ...series.map((s) => s.label)],
              rows: data.map((d) => [
                String(d['label'] ?? ''),
                ...series.map((s) => formatValue(d[s.key] as number, s.format ?? valueFormat)),
              ]),
            }
          : undefined
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: AXIS_COLOR }}
            tickLine={false}
            axisLine={{ stroke: GRID_COLOR }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11, fill: AXIS_COLOR }}
            tickLine={false}
            axisLine={false}
            width={62}
            tickFormatter={(v: number) => (valueFormat === 'percent' ? percentTick(v) : compactCurrency(v))}
          />
          <Tooltip
            content={<ChartTooltip formats={formats} />}
            cursor={{ stroke: AXIS_COLOR, strokeWidth: 1, strokeDasharray: '3 3' }}
          />
          {series.map((s) => {
            if (s.type === 'bar') {
              return (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={s.color}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={26}
                  stroke={SURFACE}
                  strokeWidth={2}
                />
              );
            }
            if (s.type === 'area') {
              return (
                <Area
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={s.color}
                  fillOpacity={0.12}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: SURFACE }}
                />
              );
            }
            return (
              <Line
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: SURFACE }}
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export { SERIES };
