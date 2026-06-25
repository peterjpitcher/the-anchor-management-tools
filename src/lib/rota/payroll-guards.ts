const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function validatePayrollPeriodRange(periodStart: string, periodEnd: string): string | null {
  if (!ISO_DATE_RE.test(periodStart) || !ISO_DATE_RE.test(periodEnd)) {
    return 'Payroll period dates must be valid YYYY-MM-DD dates'
  }

  if (periodEnd < periodStart) {
    return 'Payroll period end date must be on or after the start date'
  }

  return null
}

export function hasPayrollVariance(
  plannedHours: number | null,
  actualHours: number | null,
  shiftDate: string,
  todayIso: string,
): boolean {
  if (plannedHours === null) return false

  if (actualHours === null) {
    return shiftDate < todayIso
  }

  return Math.abs(plannedHours - actualHours) > 0.5
}
