export const PAYROLL_PERIOD_FUTURE_MONTHS = 3;

export type PayrollMonth = {
  year: number;
  month: number;
};

export type PayrollMonthOption = {
  label: string;
  value: string;
};

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function monthIndex(period: PayrollMonth): number {
  return period.year * 12 + (period.month - 1);
}

export function addPayrollMonths(period: PayrollMonth, offset: number): PayrollMonth {
  const d = new Date(Date.UTC(period.year, period.month - 1 + offset, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export function getPayrollMonthForIsoDate(anchorDateIso: string): PayrollMonth {
  const [year, month, day] = anchorDateIso.split('-').map(Number);
  let periodYear = year;
  let periodMonth = month;

  if (day >= 25) {
    periodMonth += 1;
    if (periodMonth === 13) {
      periodMonth = 1;
      periodYear += 1;
    }
  }

  return { year: periodYear, month: periodMonth };
}

export function getDefaultPayrollPeriodDates(year: number, month: number): {
  period_start: string;
  period_end: string;
} {
  const end = new Date(Date.UTC(year, month - 1, 24));
  const start = new Date(Date.UTC(year, month - 2, 25));

  return {
    period_start: isoDate(start),
    period_end: isoDate(end),
  };
}

export function formatPayrollMonthLabel(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function buildPayrollMonthOptions(
  currentPeriod: PayrollMonth,
  futureMonths: number = PAYROLL_PERIOD_FUTURE_MONTHS,
): PayrollMonthOption[] {
  const latestPeriod = addPayrollMonths(currentPeriod, futureMonths);
  const latestIndex = monthIndex(latestPeriod);
  const firstYear = currentPeriod.year - 1;
  const options: PayrollMonthOption[] = [];

  for (let year = latestPeriod.year; year >= firstYear; year--) {
    for (let month = 12; month >= 1; month--) {
      const period = { year, month };
      if (monthIndex(period) > latestIndex) continue;

      options.push({
        label: formatPayrollMonthLabel(year, month),
        value: `?year=${year}&month=${month}`,
      });
    }
  }

  return options;
}
