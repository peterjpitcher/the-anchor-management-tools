import { differenceInYears, parseISO } from 'date-fns';
import { calculatePaidHours } from '@/lib/rota/pay-calculator';

export type RotaSummaryPayrollPeriod = {
  year: number;
  month: number;
  start: string;
  end: string;
  label: string;
};

export type RotaSummaryShift = {
  employee_id: string | null;
  shift_date: string;
  start_time: string;
  end_time: string;
  unpaid_break_minutes: number;
  is_overnight: boolean;
  is_open_shift: boolean;
  status: string;
};

export type RotaSummaryEmployee = {
  employee_id: string;
  job_title: string | null;
};

export type RotaSalesTargetRow = {
  day_of_week: number;
  target_amount: number | string;
  effective_from: string;
};

export type RotaSalesTargetOverrideRow = {
  target_date: string;
  target_amount: number | string;
  reason: string | null;
};

export type RotaCashupActualRow = {
  session_date: string;
  total_counted_amount: number | string;
  status: string;
};

export type RotaRateContext = {
  salaryEmployeeIds: Set<string>;
  dobMap: Map<string, string>;
  rateOverrides: Array<{ employee_id: string; hourly_rate: string | number; effective_from: string }>;
  ageBands: Array<{ id: string; min_age: number; max_age: number | null }>;
  bandRates: Array<{ band_id: string; hourly_rate: string | number; effective_from: string }>;
};

export type RotaCostStatus = 'complete' | 'partial' | 'missing_rate' | 'salaried' | 'none';

export type RotaEmployeeSummaryTotal = {
  periodHours: number;
  estimatedCost: number | null;
  costStatus: RotaCostStatus;
  uncostedShiftCount: number;
  salariedShiftCount: number;
};

export type RotaDaySummaryTotal = {
  hours: number;
  estimatedCost: number | null;
  salesTarget: number | null;
  salesTargetSource: 'actual' | 'override' | 'default' | 'none' | 'hidden';
  salesTargetReason: string | null;
  wagePercent: number | null;
  uncostedShiftCount: number;
};

export type RotaRoleSummaryTotal = {
  employeeCount: number;
  periodHours: number;
  estimatedCost: number | null;
};

export type RotaWeekSummaryTotal = {
  estimatedCost: number | null;
  salesTarget: number | null;
  wagePercent: number | null;
  targetPercent: number;
  uncostedShiftCount: number;
};

export type RotaSummary = {
  site: { id: string; name: string | null } | null;
  payrollPeriod: RotaSummaryPayrollPeriod;
  employeeTotals: Record<string, RotaEmployeeSummaryTotal>;
  dayTotals: Record<string, RotaDaySummaryTotal>;
  roleTotals: Record<string, RotaRoleSummaryTotal>;
  weekTotals: RotaWeekSummaryTotal;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function roleNameForEmployee(employee: RotaSummaryEmployee): string {
  return employee.job_title?.trim() || 'No role';
}

export function dayOfWeekForIsoDate(isoDate: string): number {
  return new Date(isoDate + 'T12:00:00').getDay();
}

export function resolveSalesTargets(
  days: string[],
  defaultRows: RotaSalesTargetRow[],
  overrideRows: RotaSalesTargetOverrideRow[],
  actualRows: RotaCashupActualRow[] = [],
): Record<string, Pick<RotaDaySummaryTotal, 'salesTarget' | 'salesTargetSource' | 'salesTargetReason'>> {
  const actuals = new Map(
    actualRows
      .filter(row => ['submitted', 'approved', 'locked'].includes(row.status))
      .map(row => [row.session_date, Number(row.total_counted_amount)]),
  );
  const overrides = new Map(overrideRows.map(row => [
    row.target_date,
    { amount: Number(row.target_amount), reason: row.reason ?? null },
  ]));

  const defaults = [...defaultRows].sort((a, b) => b.effective_from.localeCompare(a.effective_from));

  const targets: Record<string, Pick<RotaDaySummaryTotal, 'salesTarget' | 'salesTargetSource' | 'salesTargetReason'>> = {};
  for (const day of days) {
    const actual = actuals.get(day);
    if (actual !== undefined) {
      targets[day] = {
        salesTarget: actual,
        salesTargetSource: 'actual',
        salesTargetReason: null,
      };
      continue;
    }

    const override = overrides.get(day);
    if (override) {
      targets[day] = {
        salesTarget: override.amount,
        salesTargetSource: 'override',
        salesTargetReason: override.reason,
      };
      continue;
    }

    const dow = dayOfWeekForIsoDate(day);
    const defaultTarget = defaults.find(row => row.day_of_week === dow && row.effective_from <= day);
    if (defaultTarget) {
      targets[day] = {
        salesTarget: Number(defaultTarget.target_amount),
        salesTargetSource: 'default',
        salesTargetReason: null,
      };
      continue;
    }

    targets[day] = {
      salesTarget: 0,
      salesTargetSource: 'none',
      salesTargetReason: null,
    };
  }
  return targets;
}

export function resolveHourlyRate(
  employeeId: string,
  shiftDate: string,
  rateContext: RotaRateContext,
): { rate: number; source: 'override' | 'age_band' } | null {
  if (rateContext.salaryEmployeeIds.has(employeeId)) return null;

  const override = rateContext.rateOverrides.find(
    row => row.employee_id === employeeId && row.effective_from <= shiftDate,
  );
  if (override) return { rate: Number(override.hourly_rate), source: 'override' };

  const dob = rateContext.dobMap.get(employeeId);
  if (!dob) return null;

  const age = differenceInYears(parseISO(shiftDate), parseISO(dob));
  const band = rateContext.ageBands.find(
    row => age >= row.min_age && (row.max_age === null || age <= row.max_age),
  );
  if (!band) return null;

  const bandRate = rateContext.bandRates.find(
    row => row.band_id === band.id && row.effective_from <= shiftDate,
  );
  if (!bandRate) return null;

  return { rate: Number(bandRate.hourly_rate), source: 'age_band' };
}

function summariseCostStatus(
  totalCostedShifts: number,
  uncostedShiftCount: number,
  salariedShiftCount: number,
): RotaCostStatus {
  if (totalCostedShifts === 0 && uncostedShiftCount === 0 && salariedShiftCount === 0) return 'none';
  if (totalCostedShifts === 0 && uncostedShiftCount === 0 && salariedShiftCount > 0) return 'salaried';
  if (totalCostedShifts === 0 && uncostedShiftCount > 0) return 'missing_rate';
  if (uncostedShiftCount > 0) return 'partial';
  return 'complete';
}

export function buildRotaSummary(input: {
  site: { id: string; name: string | null } | null;
  payrollPeriod: RotaSummaryPayrollPeriod;
  weekDays: string[];
  periodShifts: RotaSummaryShift[];
  employees: RotaSummaryEmployee[];
  salesTargets: Record<string, Pick<RotaDaySummaryTotal, 'salesTarget' | 'salesTargetSource' | 'salesTargetReason'>>;
  targetPercent: number;
  rateContext: RotaRateContext | null;
}): RotaSummary {
  const employeeTotals: Record<string, RotaEmployeeSummaryTotal & { costedShiftCount: number }> = {};
  const dayTotals: Record<string, RotaDaySummaryTotal> = {};
  const roleTotals: Record<string, RotaRoleSummaryTotal> = {};
  const weekDaySet = new Set(input.weekDays);
  const employeeMap = new Map(input.employees.map(employee => [employee.employee_id, employee]));

  for (const employee of input.employees) {
    employeeTotals[employee.employee_id] = {
      periodHours: 0,
      estimatedCost: input.rateContext ? 0 : null,
      costStatus: 'none',
      uncostedShiftCount: 0,
      salariedShiftCount: 0,
      costedShiftCount: 0,
    };

    const roleName = roleNameForEmployee(employee);
    const currentRole = roleTotals[roleName] ?? { employeeCount: 0, periodHours: 0, estimatedCost: input.rateContext ? 0 : null };
    currentRole.employeeCount += 1;
    roleTotals[roleName] = currentRole;
  }

  for (const day of input.weekDays) {
    const target = input.salesTargets[day];
    dayTotals[day] = {
      hours: 0,
      estimatedCost: input.rateContext ? 0 : null,
      salesTarget: target?.salesTarget ?? null,
      salesTargetSource: target?.salesTargetSource ?? 'hidden',
      salesTargetReason: target?.salesTargetReason ?? null,
      wagePercent: null,
      uncostedShiftCount: 0,
    };
  }

  for (const shift of input.periodShifts) {
    if (shift.status === 'cancelled') continue;

    const hours = calculatePaidHours(
      shift.start_time,
      shift.end_time,
      shift.unpaid_break_minutes,
      shift.is_overnight,
    );

    const isVisibleWeekDay = weekDaySet.has(shift.shift_date);
    if (isVisibleWeekDay) {
      dayTotals[shift.shift_date].hours = round2(dayTotals[shift.shift_date].hours + hours);
    }

    if (!shift.employee_id || shift.is_open_shift) {
      if (isVisibleWeekDay && input.rateContext) dayTotals[shift.shift_date].uncostedShiftCount += 1;
      continue;
    }

    const employeeTotal = employeeTotals[shift.employee_id] ?? {
      periodHours: 0,
      estimatedCost: input.rateContext ? 0 : null,
      costStatus: 'none' as RotaCostStatus,
      uncostedShiftCount: 0,
      salariedShiftCount: 0,
      costedShiftCount: 0,
    };
    employeeTotal.periodHours = round2(employeeTotal.periodHours + hours);

    const employee = employeeMap.get(shift.employee_id);
    if (employee) {
      const roleName = roleNameForEmployee(employee);
      const roleTotal = roleTotals[roleName] ?? { employeeCount: 0, periodHours: 0, estimatedCost: input.rateContext ? 0 : null };
      roleTotal.periodHours = round2(roleTotal.periodHours + hours);
      roleTotals[roleName] = roleTotal;
    }

    if (!input.rateContext) {
      employeeTotals[shift.employee_id] = employeeTotal;
      continue;
    }

    if (input.rateContext.salaryEmployeeIds.has(shift.employee_id)) {
      employeeTotal.salariedShiftCount += 1;
      employeeTotals[shift.employee_id] = employeeTotal;
      continue;
    }

    const rate = resolveHourlyRate(shift.employee_id, shift.shift_date, input.rateContext);
    if (!rate) {
      employeeTotal.uncostedShiftCount += 1;
      if (isVisibleWeekDay) dayTotals[shift.shift_date].uncostedShiftCount += 1;
      employeeTotals[shift.employee_id] = employeeTotal;
      continue;
    }

    const cost = round2(hours * rate.rate);
    employeeTotal.estimatedCost = round2((employeeTotal.estimatedCost ?? 0) + cost);
    employeeTotal.costedShiftCount += 1;
    if (isVisibleWeekDay) {
      dayTotals[shift.shift_date].estimatedCost = round2((dayTotals[shift.shift_date].estimatedCost ?? 0) + cost);
    }
    if (employee) {
      const roleName = roleNameForEmployee(employee);
      const roleTotal = roleTotals[roleName];
      if (roleTotal) {
        roleTotal.estimatedCost = round2((roleTotal.estimatedCost ?? 0) + cost);
      }
    }
    employeeTotals[shift.employee_id] = employeeTotal;
  }

  const publicEmployeeTotals: Record<string, RotaEmployeeSummaryTotal> = {};
  for (const [employeeId, total] of Object.entries(employeeTotals)) {
    publicEmployeeTotals[employeeId] = {
      periodHours: total.periodHours,
      estimatedCost: total.estimatedCost,
      costStatus: summariseCostStatus(total.costedShiftCount, total.uncostedShiftCount, total.salariedShiftCount),
      uncostedShiftCount: total.uncostedShiftCount,
      salariedShiftCount: total.salariedShiftCount,
    };
  }

  let weekEstimatedCost = input.rateContext ? 0 : null;
  let weekSalesTarget = 0;
  let hasVisibleSalesTarget = false;
  let weekUncostedShiftCount = 0;

  for (const day of input.weekDays) {
    const total = dayTotals[day];
    if (total.estimatedCost !== null) weekEstimatedCost = round2((weekEstimatedCost ?? 0) + total.estimatedCost);
    if (total.salesTarget !== null) {
      weekSalesTarget += total.salesTarget;
      hasVisibleSalesTarget = true;
    }
    if (total.estimatedCost !== null && total.salesTarget && total.salesTarget > 0) {
      total.wagePercent = round2((total.estimatedCost / total.salesTarget) * 100);
    }
    weekUncostedShiftCount += total.uncostedShiftCount;
  }

  const weekTotals: RotaWeekSummaryTotal = {
    estimatedCost: weekEstimatedCost,
    salesTarget: hasVisibleSalesTarget ? round2(weekSalesTarget) : null,
    wagePercent: weekEstimatedCost !== null && weekSalesTarget > 0 ? round2((weekEstimatedCost / weekSalesTarget) * 100) : null,
    targetPercent: input.targetPercent,
    uncostedShiftCount: weekUncostedShiftCount,
  };

  return {
    site: input.site,
    payrollPeriod: input.payrollPeriod,
    employeeTotals: publicEmployeeTotals,
    dayTotals,
    roleTotals,
    weekTotals,
  };
}
