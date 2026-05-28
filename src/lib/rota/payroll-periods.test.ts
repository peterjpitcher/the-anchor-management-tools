import {
  addPayrollMonths,
  buildPayrollMonthOptions,
  getDefaultPayrollPeriodDates,
  getPayrollMonthForIsoDate,
} from './payroll-periods';

describe('payroll period helpers', () => {
  it('uses the close month for dates from the 25th onwards', () => {
    expect(getPayrollMonthForIsoDate('2026-05-24')).toEqual({ year: 2026, month: 5 });
    expect(getPayrollMonthForIsoDate('2026-05-25')).toEqual({ year: 2026, month: 6 });
    expect(getPayrollMonthForIsoDate('2026-12-25')).toEqual({ year: 2027, month: 1 });
  });

  it('builds the default 25th to 24th period dates', () => {
    expect(getDefaultPayrollPeriodDates(2026, 6)).toEqual({
      period_start: '2026-05-25',
      period_end: '2026-06-24',
    });
  });

  it('adds payroll months across year boundaries', () => {
    expect(addPayrollMonths({ year: 2026, month: 11 }, 3)).toEqual({ year: 2027, month: 2 });
    expect(addPayrollMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });

  it('includes the current payroll month and three months ahead in selectors', () => {
    const options = buildPayrollMonthOptions({ year: 2026, month: 6 });

    expect(options.slice(0, 4)).toEqual([
      { label: 'September 2026', value: '?year=2026&month=9' },
      { label: 'August 2026', value: '?year=2026&month=8' },
      { label: 'July 2026', value: '?year=2026&month=7' },
      { label: 'June 2026', value: '?year=2026&month=6' },
    ]);
    expect(options).not.toContainEqual({ label: 'October 2026', value: '?year=2026&month=10' });
  });
});
