import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const payrollActions = readFileSync(resolve(process.cwd(), 'src/app/actions/payroll.ts'), 'utf8')
const payrollClient = readFileSync(resolve(process.cwd(), 'src/app/(authenticated)/rota/payroll/PayrollClient.tsx'), 'utf8')
const rotaPayroll = readFileSync(resolve(process.cwd(), 'src/app/(authenticated)/rota/_components/RotaPayroll.tsx'), 'utf8')

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`)
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0)
  const next = source.indexOf('\nexport ', start + 1)
  return source.slice(start, next === -1 ? undefined : next)
}

describe('A-088 payroll wiring', () => {
  it('flags past no-shows as payroll variance through the shared guard', () => {
    expect(payrollActions).toContain('hasPayrollVariance(plannedHours, actualHours, shift.shift_date, todayIso)')
  })

  it('validates payroll period ranges on the server and client', () => {
    expect(functionBody(payrollActions, 'updatePayrollPeriod')).toContain('validatePayrollPeriodRange(periodStart, periodEnd)')
    expect(payrollClient).toContain('validatePayrollPeriodRange(periodStart, periodEnd)')
  })

  it('invalidates approved snapshots when payroll notes change', () => {
    const body = functionBody(payrollActions, 'upsertShiftNote')
    expect(body).toContain('await invalidatePayrollApproval(createAdminClient(), year, month)')
    expect(payrollClient).toContain('upsertShiftNote(shiftId, editNoteValue, year, month)')
  })

  it('does not use dead no-op payroll run menu handlers', () => {
    expect(rotaPayroll).not.toContain('onClick={() => {}}')
    expect(rotaPayroll).toContain("window.location.assign('/rota/payroll')")
  })
})
