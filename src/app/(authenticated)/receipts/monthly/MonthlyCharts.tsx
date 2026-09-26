'use client';

import { useMemo } from 'react';
import {
  Card,
  CardBody,
  CardHeader,
  ChartTooltipRow,
  ComboChart,
  Empty,
  chartColour,
  type ChartSeries,
} from '@/ds';
import { RECEIPT_FLOW_CHART_COLOUR } from '../_shared/status-ui';

type MonthlyChartPoint = {
  monthStart: string;
  income: number;
  outgoing: number;
};

const monthFormatter = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function formatMonth(value: string): string {
  return monthFormatter.format(new Date(value));
}

function formatPounds(value: number): string {
  return currencyFormatter.format(value);
}

// Income and spending keep the colours they have everywhere else in Receipts (income green, spend
// red) rather than the next chart tokens, so the chart reads at a glance.
const INCOME_SPEND_SERIES: ChartSeries[] = [
  { key: 'income', label: 'Income', color: RECEIPT_FLOW_CHART_COLOUR.income, format: formatPounds },
  { key: 'outgoing', label: 'Spending', color: RECEIPT_FLOW_CHART_COLOUR.spend, format: formatPounds },
];

export function MonthlyCharts({ data }: { data: MonthlyChartPoint[] }) {
  const ordered = useMemo(
    () => [...data].sort((a, b) => a.monthStart.localeCompare(b.monthStart)),
    [data],
  );

  if (ordered.length === 0) {
    return (
      <Card>
        <Empty
          size="sm"
          title="No income or spending for this period"
          description="Nothing came in or went out in the last 12 months."
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Income vs Spending (Last 12 Months)" />
      <CardBody>
        <ComboChart
          data={ordered}
          xKey="monthStart"
          series={INCOME_SPEND_SERIES}
          formatX={formatMonth}
          leftAxis={{ format: 'shorthandCurrency' }}
          maxBarSize={28}
          ariaLabel="Income and spending by month, last 12 months"
        />
      </CardBody>
    </Card>
  );
}

type StackedBreakdownPoint = {
  monthStart: string;
  segments: Array<{ label: string; amount: number }>;
};

type StackedBreakdownRow = Record<string, string | number> & { monthStart: string };

/**
 * One stacked bar per month, one segment per category. Categories are ordered by their total over
 * the period and take the chart colours in that order; "Other" always takes the last one.
 */
export function StackedBreakdownChart({
  title,
  data,
  emptyTitle,
  emptyDescription,
}: {
  title: string;
  data: StackedBreakdownPoint[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  const ordered = useMemo(
    () => [...data].sort((a, b) => a.monthStart.localeCompare(b.monthStart)),
    [data],
  );

  const { rows, series } = useMemo(() => {
    const labelTotals = ordered.reduce<Record<string, number>>((acc, point) => {
      point.segments.forEach((segment) => {
        if (!segment.amount) return;
        acc[segment.label] = (acc[segment.label] ?? 0) + segment.amount;
      });
      return acc;
    }, {});

    const legendLabels = Object.entries(labelTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([label]) => label);

    // Series keys are positional, so a category name can never clash with the month field.
    const keyFor = new Map(legendLabels.map((label, index) => [label, `segment${index}`]));

    const breakdownRows: StackedBreakdownRow[] = ordered.map((point) => {
      const row: StackedBreakdownRow = { monthStart: point.monthStart };
      point.segments.forEach((segment) => {
        const key = keyFor.get(segment.label);
        if (!key || segment.amount <= 0) return;
        row[key] = (typeof row[key] === 'number' ? (row[key] as number) : 0) + segment.amount;
      });
      return row;
    });

    const breakdownSeries: ChartSeries[] = legendLabels.map((label, index) => ({
      key: `segment${index}`,
      label,
      stackId: 'total',
      color: label === 'Other' ? chartColour(5) : chartColour(index),
      format: formatPounds,
    }));

    return { rows: breakdownRows, series: breakdownSeries };
  }, [ordered]);

  // Only positive amounts become bars, so a chart with none of them is empty.
  const hasValues = ordered.some((point) => point.segments.some((segment) => segment.amount > 0));

  return (
    <Card className="h-full">
      <CardHeader title={title} />
      <CardBody>
        {!hasValues ? (
          <Empty size="sm" title={emptyTitle} description={emptyDescription} />
        ) : (
          <ComboChart
            data={rows}
            xKey="monthStart"
            series={series}
            formatX={formatMonth}
            leftAxis={{ format: 'shorthandCurrency' }}
            showLegend
            maxBarSize={28}
            ariaLabel={`${title} by month`}
            renderTooltip={({ items }) => (
              <>
                {items.map((item) => (
                  <ChartTooltipRow key={item.key} color={item.color} label={item.label} value={item.formatted} />
                ))}
                <ChartTooltipRow
                  label="Total"
                  value={formatPounds(items.reduce((sum, item) => sum + item.value, 0))}
                />
              </>
            )}
          />
        )}
      </CardBody>
    </Card>
  );
}
