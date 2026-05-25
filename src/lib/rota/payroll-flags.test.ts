import { describe, expect, it } from 'vitest';
import {
  formatPayrollFlags,
  hasCouldntWorkPayrollFlag,
  isCouldntWorkPayrollFlag,
  parsePayrollFlags,
  payrollFlagLabel,
} from './payroll-flags';

describe('payroll flag helpers', () => {
  it('parses comma-separated payroll flags defensively', () => {
    expect(parsePayrollFlags(' auto_close, sick,, variance ')).toEqual(['auto_close', 'sick', 'variance']);
  });

  it("labels legacy sick and new couldnt_work flags as Couldn't Work", () => {
    expect(isCouldntWorkPayrollFlag('sick')).toBe(true);
    expect(isCouldntWorkPayrollFlag('couldnt_work')).toBe(true);
    expect(payrollFlagLabel('sick')).toBe("Couldn't Work");
    expect(formatPayrollFlags('sick, variance')).toBe("Couldn't Work, variance");
  });

  it("detects Couldn't Work flags without matching unrelated flags", () => {
    expect(hasCouldntWorkPayrollFlag('auto_close, couldnt_work')).toBe(true);
    expect(hasCouldntWorkPayrollFlag('auto_close, variance')).toBe(false);
  });
});
