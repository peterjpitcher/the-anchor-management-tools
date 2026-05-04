import { describe, expect, it } from 'vitest';
import {
  buildRotaSummary,
  resolveSalesTargets,
  type RotaRateContext,
  type RotaSummaryPayrollPeriod,
  type RotaSummaryShift,
} from '@/lib/rota/summary';

const period: RotaSummaryPayrollPeriod = {
  year: 2026,
  month: 3,
  start: '2026-02-25',
  end: '2026-03-24',
  label: 'March 2026',
};

describe('resolveSalesTargets', () => {
  it('uses a date override before the effective day-of-week target', () => {
    const result = resolveSalesTargets(
      ['2026-03-16', '2026-03-17'],
      [
        { day_of_week: 1, target_amount: 1000, effective_from: '2026-01-01' },
        { day_of_week: 2, target_amount: 1200, effective_from: '2026-01-01' },
      ],
      [{ target_date: '2026-03-17', target_amount: 2500, reason: 'quiz night' }],
    );

    expect(result['2026-03-16']).toEqual({
      salesTarget: 1000,
      salesTargetSource: 'default',
      salesTargetReason: null,
    });
    expect(result['2026-03-17']).toEqual({
      salesTarget: 2500,
      salesTargetSource: 'override',
      salesTargetReason: 'quiz night',
    });
  });

  it('uses submitted cash-up actuals before targets once a day has been cashed up', () => {
    const result = resolveSalesTargets(
      ['2026-03-17'],
      [{ day_of_week: 2, target_amount: 1200, effective_from: '2026-01-01' }],
      [{ target_date: '2026-03-17', target_amount: 2500, reason: 'quiz night' }],
      [{ session_date: '2026-03-17', total_counted_amount: 3125.5, status: 'submitted' }],
    );

    expect(result['2026-03-17']).toEqual({
      salesTarget: 3125.5,
      salesTargetSource: 'actual',
      salesTargetReason: null,
    });
  });

  it('falls back to zero when no default or override exists', () => {
    const result = resolveSalesTargets(['2026-03-16'], [], []);
    expect(result['2026-03-16']).toEqual({
      salesTarget: 0,
      salesTargetSource: 'none',
      salesTargetReason: null,
    });
  });
});

describe('buildRotaSummary', () => {
  const rateContext: RotaRateContext = {
    salaryEmployeeIds: new Set(['emp-salary']),
    dobMap: new Map(),
    rateOverrides: [{ employee_id: 'emp-hourly', hourly_rate: 10, effective_from: '2026-01-01' }],
    ageBands: [],
    bandRates: [],
  };

  const shifts: RotaSummaryShift[] = [
    {
      employee_id: 'emp-hourly',
      shift_date: '2026-03-16',
      start_time: '09:00',
      end_time: '17:00',
      unpaid_break_minutes: 0,
      is_overnight: false,
      is_open_shift: false,
      status: 'scheduled',
    },
    {
      employee_id: 'emp-missing-rate',
      shift_date: '2026-03-16',
      start_time: '18:00',
      end_time: '22:00',
      unpaid_break_minutes: 0,
      is_overnight: false,
      is_open_shift: false,
      status: 'scheduled',
    },
    {
      employee_id: null,
      shift_date: '2026-03-16',
      start_time: '12:00',
      end_time: '17:00',
      unpaid_break_minutes: 0,
      is_overnight: false,
      is_open_shift: true,
      status: 'scheduled',
    },
    {
      employee_id: 'emp-salary',
      shift_date: '2026-03-17',
      start_time: '10:00',
      end_time: '16:00',
      unpaid_break_minutes: 0,
      is_overnight: false,
      is_open_shift: false,
      status: 'scheduled',
    },
    {
      employee_id: 'emp-hourly',
      shift_date: '2026-03-17',
      start_time: '10:00',
      end_time: '18:00',
      unpaid_break_minutes: 0,
      is_overnight: false,
      is_open_shift: false,
      status: 'cancelled',
    },
  ];

  it('calculates scheduled costs, day wage percentages, and employee cost statuses', () => {
    const summary = buildRotaSummary({
      site: { id: 'site-1', name: 'The Anchor' },
      payrollPeriod: period,
      weekDays: ['2026-03-16', '2026-03-17'],
      periodShifts: shifts,
      employees: [
        { employee_id: 'emp-hourly', job_title: 'Bar' },
        { employee_id: 'emp-missing-rate', job_title: 'Kitchen' },
        { employee_id: 'emp-salary', job_title: 'Bar' },
      ],
      salesTargets: {
        '2026-03-16': { salesTarget: 400, salesTargetSource: 'default', salesTargetReason: null },
        '2026-03-17': { salesTarget: 1000, salesTargetSource: 'default', salesTargetReason: null },
      },
      targetPercent: 25,
      rateContext,
    });

    expect(summary.employeeTotals['emp-hourly']).toMatchObject({
      periodHours: 8,
      estimatedCost: 80,
      costStatus: 'complete',
    });
    expect(summary.employeeTotals['emp-missing-rate']).toMatchObject({
      periodHours: 4,
      estimatedCost: 0,
      costStatus: 'missing_rate',
      uncostedShiftCount: 1,
    });
    expect(summary.employeeTotals['emp-salary']).toMatchObject({
      periodHours: 6,
      estimatedCost: 0,
      costStatus: 'salaried',
    });

    expect(summary.dayTotals['2026-03-16']).toMatchObject({
      hours: 17,
      estimatedCost: 80,
      salesTarget: 400,
      wagePercent: 20,
      uncostedShiftCount: 2,
    });
    expect(summary.weekTotals).toMatchObject({
      estimatedCost: 80,
      salesTarget: 1400,
      targetPercent: 25,
      uncostedShiftCount: 2,
    });
    expect(summary.weekTotals.wagePercent).toBeCloseTo(5.71, 2);
    expect(summary.roleTotals.Bar).toMatchObject({ employeeCount: 2, periodHours: 14, estimatedCost: 80 });
  });

  it('hides cost and wage percentage calculations when no rate context is provided', () => {
    const summary = buildRotaSummary({
      site: null,
      payrollPeriod: period,
      weekDays: ['2026-03-16'],
      periodShifts: shifts.slice(0, 1),
      employees: [{ employee_id: 'emp-hourly', job_title: 'Bar' }],
      salesTargets: {
        '2026-03-16': { salesTarget: null, salesTargetSource: 'hidden', salesTargetReason: null },
      },
      targetPercent: 25,
      rateContext: null,
    });

    expect(summary.employeeTotals['emp-hourly']).toMatchObject({
      periodHours: 8,
      estimatedCost: null,
      costStatus: 'none',
    });
    expect(summary.dayTotals['2026-03-16']).toMatchObject({
      estimatedCost: null,
      salesTarget: null,
      wagePercent: null,
    });
    expect(summary.weekTotals).toMatchObject({
      estimatedCost: null,
      salesTarget: null,
      wagePercent: null,
    });
  });

  it('costs visible week days outside the selected payroll period without adding them to employee period totals', () => {
    const aprilPeriod: RotaSummaryPayrollPeriod = {
      year: 2026,
      month: 4,
      start: '2026-03-25',
      end: '2026-04-24',
      label: 'April 2026',
    };

    const summary = buildRotaSummary({
      site: { id: 'site-1', name: 'The Anchor' },
      payrollPeriod: aprilPeriod,
      weekDays: ['2026-04-24', '2026-04-25'],
      periodShifts: [
        {
          employee_id: 'emp-hourly',
          shift_date: '2026-04-24',
          start_time: '10:00',
          end_time: '16:00',
          unpaid_break_minutes: 0,
          is_overnight: false,
          is_open_shift: false,
          status: 'scheduled',
        },
        {
          employee_id: 'emp-hourly',
          shift_date: '2026-04-25',
          start_time: '12:00',
          end_time: '18:00',
          unpaid_break_minutes: 0,
          is_overnight: false,
          is_open_shift: false,
          status: 'scheduled',
        },
      ],
      employees: [{ employee_id: 'emp-hourly', job_title: 'Bar' }],
      salesTargets: {
        '2026-04-24': { salesTarget: 1000, salesTargetSource: 'default', salesTargetReason: null },
        '2026-04-25': { salesTarget: 1000, salesTargetSource: 'default', salesTargetReason: null },
      },
      targetPercent: 25,
      rateContext,
    });

    expect(summary.employeeTotals['emp-hourly']).toMatchObject({
      periodHours: 6,
      estimatedCost: 60,
      costStatus: 'complete',
    });
    expect(summary.dayTotals['2026-04-25']).toMatchObject({
      hours: 6,
      estimatedCost: 60,
      wagePercent: 6,
    });
    expect(summary.weekTotals).toMatchObject({
      estimatedCost: 120,
      salesTarget: 2000,
      wagePercent: 6,
    });
  });
});
