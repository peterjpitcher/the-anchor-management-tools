export const PAYROLL_COULDNT_WORK_FLAG = 'couldnt_work';

export function parsePayrollFlags(flags: string): string[] {
  return flags
    .split(',')
    .map(flag => flag.trim())
    .filter(Boolean);
}

export function isCouldntWorkPayrollFlag(flag: string): boolean {
  const normalized = flag.trim().toLowerCase();
  return normalized === PAYROLL_COULDNT_WORK_FLAG || normalized === 'sick' || normalized === "couldn't work";
}

export function payrollFlagLabel(flag: string): string {
  return isCouldntWorkPayrollFlag(flag) ? "Couldn't Work" : flag;
}

export function formatPayrollFlags(flags: string): string {
  return parsePayrollFlags(flags).map(payrollFlagLabel).join(', ');
}

export function hasCouldntWorkPayrollFlag(flags: string): boolean {
  return parsePayrollFlags(flags).some(isCouldntWorkPayrollFlag);
}
