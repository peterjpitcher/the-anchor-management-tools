// src/app/(authenticated)/rota/payroll/PayrollSummaryBar.tsx
'use client';

import { useMemo } from 'react';
import { Stat, StatGrid } from '@/ds';
import { getTodayIsoDate } from '@/lib/dateUtils';
import { computeCycleStats } from './payrollCycleStats';
import type { PayrollRow } from '@/lib/rota/excel-export';
import { PAYROLL_EARNED_TONE, PAYROLL_VARIANCE_TONE, ROTA_STAT_TONE, payrollVarianceState } from '../_shared/status-ui';

interface PayrollSummaryBarProps {
  rows: PayrollRow[];
}

function varianceSubLabel(variance: number): string {
  if (variance >= 0) return 'ahead of plan';
  return 'under planned';
}

/** Placeholder while no row has reached today's cut-off yet. */
const NO_VALUE = '–';

export function PayrollSummaryBar({ rows }: PayrollSummaryBarProps) {
  const today = getTodayIsoDate();

  const stats = useMemo(
    () => computeCycleStats(rows, today),
    [rows, today]
  );

  const variance = stats.actualToDate - stats.plannedToDate;
  const varianceState = payrollVarianceState(variance);

  // The variance takes the colour of how the cycle stands (ahead, a little under, well under);
  // money earned keeps the success colour it had before the Stat tiles, as the cards below.
  return (
    <StatGrid columns={4}>
      <Stat
        label="Planned to date"
        value={stats.hasCutoffRows ? `${stats.plannedToDate.toFixed(1)}h` : NO_VALUE}
        hint={
          stats.hasCutoffRows && stats.totalPlannedFullCycle > stats.plannedToDate
            ? `of ${stats.totalPlannedFullCycle.toFixed(1)}h total`
            : undefined
        }
      />
      <Stat
        label="Actual to date"
        value={stats.hasCutoffRows ? `${stats.actualToDate.toFixed(1)}h` : NO_VALUE}
      />
      <Stat
        label="Variance"
        value={stats.hasCutoffRows ? `${variance >= 0 ? '+' : ''}${variance.toFixed(1)}h` : NO_VALUE}
        hint={stats.hasCutoffRows ? varianceSubLabel(variance) : undefined}
        tone={stats.hasCutoffRows ? ROTA_STAT_TONE[PAYROLL_VARIANCE_TONE[varianceState]] : 'default'}
      />
      <Stat
        label="Earned to date"
        value={stats.hasCutoffRows ? `£${stats.earnedToDate.toFixed(2)}` : NO_VALUE}
        tone={stats.hasCutoffRows ? ROTA_STAT_TONE[PAYROLL_EARNED_TONE] : 'default'}
      />
    </StatGrid>
  );
}
