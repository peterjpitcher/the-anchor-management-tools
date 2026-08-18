// src/app/(authenticated)/rota/payroll/PayrollSummaryBar.tsx
'use client';

import { useMemo } from 'react';
import { getTodayIsoDate } from '@/lib/dateUtils';
import { computeCycleStats } from './payrollCycleStats';
import type { PayrollRow } from '@/lib/rota/excel-export';

interface PayrollSummaryBarProps {
  rows: PayrollRow[];
}

function varianceTileClasses(variance: number): string {
  // green if >= 0, amber if > -10 and < 0, red if <= -10
  if (variance >= 0) return 'bg-success-soft border-success/30 text-success-fg';
  if (variance > -10) return 'bg-warning-soft border-warning/25 text-warning-fg';
  return 'bg-danger-soft border-danger/25 text-danger-fg';
}

function varianceSubLabel(variance: number): string {
  if (variance >= 0) return 'ahead of plan';
  return 'under planned';
}

export function PayrollSummaryBar({ rows }: PayrollSummaryBarProps) {
  const today = getTodayIsoDate();

  const stats = useMemo(
    () => computeCycleStats(rows, today),
    [rows, today]
  );

  const variance = stats.actualToDate - stats.plannedToDate;
  const dash = '—';

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {/* Planned to date */}
      <div className="text-center bg-surface-2 border border-border rounded-lg p-3">
        <p className="text-xl font-bold text-text-strong">
          {stats.hasCutoffRows ? `${stats.plannedToDate.toFixed(1)}h` : dash}
        </p>
        <p className="text-xs text-text-muted mt-0.5">Planned to date</p>
        {stats.hasCutoffRows && stats.totalPlannedFullCycle > stats.plannedToDate && (
          <p className="text-xs text-text-subtle mt-0.5">
            of {stats.totalPlannedFullCycle.toFixed(1)}h total
          </p>
        )}
      </div>

      {/* Actual to date */}
      <div className="text-center bg-surface-2 border border-border rounded-lg p-3">
        <p className="text-xl font-bold text-text-strong">
          {stats.hasCutoffRows ? `${stats.actualToDate.toFixed(1)}h` : dash}
        </p>
        <p className="text-xs text-text-muted mt-0.5">Actual to date</p>
      </div>

      {/* Variance */}
      <div
        className={`text-center border rounded-lg p-3 ${
          stats.hasCutoffRows
            ? varianceTileClasses(variance)
            : 'bg-surface-2 border-border text-text-strong'
        }`}
      >
        <p className="text-xl font-bold">
          {stats.hasCutoffRows
            ? `${variance >= 0 ? '+' : ''}${variance.toFixed(1)}h`
            : dash}
        </p>
        <p className="text-xs mt-0.5 opacity-70">
          {stats.hasCutoffRows ? varianceSubLabel(variance) : 'Variance'}
        </p>
      </div>

      {/* Earned to date */}
      <div className="text-center bg-success-soft border border-success/30 rounded-lg p-3">
        <p className="text-xl font-bold text-success-fg">
          {stats.hasCutoffRows ? `£${stats.earnedToDate.toFixed(2)}` : dash}
        </p>
        <p className="text-xs text-text-muted mt-0.5">Earned to date</p>
      </div>
    </div>
  );
}
