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
  if (variance >= 0) return 'bg-green-50 border-green-100 text-green-800';
  if (variance > -10) return 'bg-amber-50 border-amber-100 text-amber-800';
  return 'bg-red-50 border-red-100 text-red-800';
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
      <div className="text-center bg-gray-50 border border-gray-100 rounded-lg p-3">
        <p className="text-xl font-bold text-gray-900">
          {stats.hasCutoffRows ? `${stats.plannedToDate.toFixed(1)}h` : dash}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">Planned to date</p>
        {stats.hasCutoffRows && stats.totalPlannedFullCycle > stats.plannedToDate && (
          <p className="text-xs text-gray-400 mt-0.5">
            of {stats.totalPlannedFullCycle.toFixed(1)}h total
          </p>
        )}
      </div>

      {/* Actual to date */}
      <div className="text-center bg-gray-50 border border-gray-100 rounded-lg p-3">
        <p className="text-xl font-bold text-gray-900">
          {stats.hasCutoffRows ? `${stats.actualToDate.toFixed(1)}h` : dash}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">Actual to date</p>
      </div>

      {/* Variance */}
      <div
        className={`text-center border rounded-lg p-3 ${
          stats.hasCutoffRows
            ? varianceTileClasses(variance)
            : 'bg-gray-50 border-gray-100 text-gray-900'
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
      <div className="text-center bg-green-50 border border-green-100 rounded-lg p-3">
        <p className="text-xl font-bold text-green-800">
          {stats.hasCutoffRows ? `£${stats.earnedToDate.toFixed(2)}` : dash}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">Earned to date</p>
      </div>
    </div>
  );
}
