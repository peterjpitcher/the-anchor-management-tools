// src/app/(authenticated)/rota/payroll/PayrollSummaryBar.tsx
'use client';

import { useMemo } from 'react';
import { Icon, Stat, StatGrid } from '@/ds';
import { getTodayIsoDate } from '@/lib/dateUtils';
import { computeCycleStats } from './payrollCycleStats';
import type { PayrollRow } from '@/lib/rota/excel-export';
import {
  PAYROLL_VARIANCE_ICON,
  PAYROLL_VARIANCE_TONE,
  ROTA_TONE_ICON_CLASSES,
  payrollVarianceState,
} from '../_shared/status-ui';

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

  // A Stat has no tone of its own, so the variance carries its state (ahead, a little under,
  // well under) as an icon in the tone's colour.
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
        icon={
          stats.hasCutoffRows ? (
            <Icon
              name={PAYROLL_VARIANCE_ICON[varianceState]}
              size={20}
              label={varianceSubLabel(variance)}
              className={ROTA_TONE_ICON_CLASSES[PAYROLL_VARIANCE_TONE[varianceState]]}
            />
          ) : undefined
        }
      />
      <Stat
        label="Earned to date"
        value={stats.hasCutoffRows ? `£${stats.earnedToDate.toFixed(2)}` : NO_VALUE}
      />
    </StatGrid>
  );
}
