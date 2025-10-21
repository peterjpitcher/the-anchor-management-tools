'use client';

import { useMemo } from 'react';
import { Card } from '@/components/ui-v2/layout/Card';
import { EmptyState } from '@/components/ui-v2/display/EmptyState';

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

export function MonthlyCharts({ data }: { data: MonthlyChartPoint[] }) {
  const ordered = useMemo(
    () => [...data].sort((a, b) => a.monthStart.localeCompare(b.monthStart)),
    [data],
  );

  const maxValue = useMemo(() => {
    const peak = ordered.reduce(
      (max, point) => Math.max(max, point.income, point.outgoing),
      0,
    );
    return peak > 0 ? peak : 1;
  }, [ordered]);

  if (ordered.length === 0) {
    return (
      <Card variant="bordered">
        <EmptyState
          title="No data available"
          description="We couldn’t find any income or spending in the last 12 months."
        />
      </Card>
    );
  }

  return (
    <Card
      variant="bordered"
      header={<h3 className="text-base font-semibold text-gray-900">Income vs spending (last 12 months)</h3>}
    >
      <div className="mb-4 flex items-center gap-4 text-sm text-gray-600">
        <LegendSwatch className="bg-emerald-500" label="Income" />
        <LegendSwatch className="bg-rose-500" label="Spending" />
      </div>
      <div className="overflow-x-auto">
        <div className="flex min-w-[720px] gap-4 pb-2">
          {ordered.map((point) => {
            const incomeHeight = Math.max((point.income / maxValue) * 100, 0);
            const outgoingHeight = Math.max((point.outgoing / maxValue) * 100, 0);
            const monthLabel = monthFormatter.format(new Date(point.monthStart));

            return (
              <div key={point.monthStart} className="flex flex-col items-center gap-2 text-xs">
                <div className="flex h-64 w-16 items-end justify-center gap-1 rounded-md bg-emerald-50/20 p-2">
                  <Bar
                    heightPercent={incomeHeight}
                    colorClass="bg-emerald-500"
                    value={point.income}
                    ariaLabel={`${monthLabel} income ${currencyFormatter.format(point.income)}`}
                  />
                  <Bar
                    heightPercent={outgoingHeight}
                    colorClass="bg-rose-500"
                    value={point.outgoing}
                    ariaLabel={`${monthLabel} spending ${currencyFormatter.format(point.outgoing)}`}
                  />
                </div>
                <span className="text-center font-medium text-gray-700">{monthLabel}</span>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function Bar({
  heightPercent,
  colorClass,
  value,
  ariaLabel,
}: {
  heightPercent: number;
  colorClass: string;
  value: number;
  ariaLabel: string;
}) {
  const formattedValue = currencyFormatter.format(value);
  const clampedHeight = Number.isFinite(heightPercent) ? Math.max(heightPercent, 2) : 2;

  return (
    <div
      className={`relative flex w-6 items-end justify-center rounded-md ${colorClass}`}
      style={{ height: `${clampedHeight}%` }}
      aria-label={ariaLabel}
    >
      <span className="absolute -top-6 text-[11px] font-semibold text-gray-700">
        {formattedValue}
      </span>
    </div>
  );
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-block h-3 w-3 rounded ${className}`} />
      <span>{label}</span>
    </span>
  );
}

type StackedBreakdownPoint = {
  monthStart: string;
  segments: Array<{ label: string; amount: number }>;
};

export function StackedBreakdownChart({
  title,
  data,
  palette,
  emptyDescription,
}: {
  title: string;
  data: StackedBreakdownPoint[];
  palette: string[];
  emptyDescription: string;
}) {
  const ordered = useMemo(
    () => [...data].sort((a, b) => a.monthStart.localeCompare(b.monthStart)),
    [data],
  );

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

  const colorMap = new Map<string, string>();
  legendLabels.forEach((label, index) => {
    colorMap.set(label, palette[index % palette.length]);
  });
  colorMap.set('Other', palette[palette.length - 1] ?? 'bg-gray-300');

  const hasValues = ordered.some((point) => point.segments.some((segment) => segment.amount > 0));

  return (
    <Card
      variant="bordered"
      header={<h3 className="text-base font-semibold text-gray-900">{title}</h3>}
      className="h-full"
    >
      {!hasValues ? (
        <EmptyState title="No data available" description={emptyDescription} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
            {legendLabels.map((label) => (
              <LegendSwatch key={label} className={colorMap.get(label) ?? 'bg-gray-300'} label={label} />
            ))}
          </div>

          <div className="flex flex-col gap-3">
            {ordered.map((point) => {
              const total = point.segments.reduce((sum, segment) => sum + segment.amount, 0);
              const monthLabel = monthFormatter.format(new Date(point.monthStart));

              return (
                <div key={point.monthStart} className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-gray-600">
                    <span>{monthLabel}</span>
                    <span className="font-medium text-gray-800">{currencyFormatter.format(total)}</span>
                  </div>
                  {total === 0 ? (
                    <div className="flex h-10 items-center justify-center rounded-lg border border-dashed border-gray-200 text-xs text-gray-400">
                      No activity recorded
                    </div>
                  ) : (
                    <div className="flex h-10 overflow-hidden rounded-lg border border-gray-200 bg-white">
                      {point.segments
                        .filter((segment) => segment.amount > 0)
                        .map((segment) => {
                          const width = (segment.amount / total) * 100;
                          const colorClass = colorMap.get(segment.label) ?? 'bg-gray-300';
                          const label = `${segment.label} · ${currencyFormatter.format(segment.amount)}`;

                          return (
                            <div
                              key={segment.label}
                              className={`h-full ${colorClass}`}
                              style={{ width: `${width}%` }}
                              title={label}
                            />
                          );
                        })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}
