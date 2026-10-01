import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PAYROLL_REFERENCE,
  containsEmployeeName,
  recognisePayrollPayment,
  type PayrollEmployee,
} from '@/lib/receipts/payroll-recognition'

// Invented people. No real member of staff appears in a test.
const employees: PayrollEmployee[] = [
  { id: 'e1', firstName: 'Morwenna', lastName: 'Trevithick' },
  { id: 'e2', firstName: 'Jago', lastName: "O'Rourke", preferredName: 'Jay' },
  { id: 'e3', firstName: 'Zoë', lastName: 'Penhaligon-Smythe' },
  { id: 'e4', firstName: 'Morgan', lastName: 'Trevithick' },
]

describe('recognisePayrollPayment', () => {
  it('recognises a wage: one full name and the payroll reference, money out', () => {
    const result = recognisePayrollPayment('MORWENNA TREVITHICK THE ANCHOR', 'out', employees)
    expect(result).toEqual({ kind: 'wage', employee: employees[0] })
  })

  it('uses the reference it is given, and the default is the one the payroll run uses', () => {
    expect(DEFAULT_PAYROLL_REFERENCE).toBe('the anchor')
    expect(recognisePayrollPayment('Morwenna Trevithick WAGES OCT', 'out', employees, 'wages').kind).toBe('wage')
    // The default reference is not on this line, so it is not certain.
    expect(recognisePayrollPayment('Morwenna Trevithick WAGES OCT', 'out', employees)).toMatchObject({
      kind: 'check',
      reason: 'name_without_reference',
    })
  })

  it('matches a preferred name, an apostrophe, an accent and a title', () => {
    expect(recognisePayrollPayment("Jay O'Rourke The Anchor", 'out', employees)).toMatchObject({
      kind: 'wage',
      employee: { id: 'e2' },
    })
    expect(recognisePayrollPayment('JAGO OROURKE THE ANCHOR', 'out', employees)).toMatchObject({
      kind: 'wage',
      employee: { id: 'e2' },
    })
    expect(recognisePayrollPayment('MISS ZOE PENHALIGON-SMYTHE THE ANCHOR', 'out', employees)).toMatchObject({
      kind: 'wage',
      employee: { id: 'e3' },
    })
  })

  it('holds a name without the reference for a person to check: it may be an expense repaid', () => {
    expect(recognisePayrollPayment('MORWENNA TREVITHICK PETTY CASH', 'out', employees)).toEqual({
      kind: 'check',
      reason: 'name_without_reference',
      employees: [employees[0]],
    })
  })

  it('holds a line that fits more than one member of staff', () => {
    const result = recognisePayrollPayment('MORWENNA TREVITHICK MORGAN TREVITHICK THE ANCHOR', 'out', employees)
    expect(result).toMatchObject({ kind: 'check', reason: 'ambiguous_name' })
    expect(result.kind === 'check' && result.employees.map((employee) => employee.id)).toEqual(['e1', 'e4'])
  })

  it('holds an initial and a surname with the reference: probably wages, not certain', () => {
    const result = recognisePayrollPayment('M TREVITHICK THE ANCHOR', 'out', employees)
    expect(result).toMatchObject({ kind: 'check', reason: 'initial_only' })
    // Both people called M Trevithick are offered.
    expect(result.kind === 'check' && result.employees.map((employee) => employee.id).sort()).toEqual(['e1', 'e4'])
  })

  it('holds the payroll reference with a name nobody knows: someone missing from the list', () => {
    expect(recognisePayrollPayment('DEMELZA CARNE THE ANCHOR', 'out', employees)).toEqual({
      kind: 'check',
      reason: 'reference_without_name',
      employees: [],
    })
  })

  it('never calls money in a wage, but still flags the name', () => {
    expect(recognisePayrollPayment('MORWENNA TREVITHICK THE ANCHOR', 'in', employees)).toMatchObject({
      kind: 'check',
      reason: 'name_without_reference',
    })
    expect(recognisePayrollPayment('THE ANCHOR CARD SETTLEMENT', 'in', employees)).toEqual({ kind: 'none' })
  })

  it('leaves an ordinary supplier alone', () => {
    expect(recognisePayrollPayment('BOOKER CASH AND CARRY', 'out', employees)).toEqual({ kind: 'none' })
    expect(recognisePayrollPayment('', 'out', employees)).toEqual({ kind: 'none' })
  })

  it('does not take a surname alone, or a first name alone, for a member of staff', () => {
    expect(recognisePayrollPayment('TREVITHICK BUTCHERS LTD', 'out', employees)).toEqual({ kind: 'none' })
    expect(recognisePayrollPayment('MORWENNA FLOWERS', 'out', employees)).toEqual({ kind: 'none' })
  })

  it('does not match a name that is only part of a longer word', () => {
    expect(recognisePayrollPayment('JAYNE OROURKESON THE ANCHOR', 'out', employees)).toMatchObject({
      kind: 'check',
      reason: 'reference_without_name',
    })
  })

  it('with no employees, only the reference is noticed', () => {
    expect(recognisePayrollPayment('SOMEONE NEW THE ANCHOR', 'out', [])).toMatchObject({
      kind: 'check',
      reason: 'reference_without_name',
    })
    expect(recognisePayrollPayment('BOOKER', 'out', [])).toEqual({ kind: 'none' })
  })
})

describe('containsEmployeeName', () => {
  it('finds a full name anywhere in the text, whatever the case or title', () => {
    expect(containsEmployeeName('FP MR JAGO OROURKE REF 123', employees)).toBe(true)
    expect(containsEmployeeName('zoë penhaligon smythe', employees)).toBe(true)
  })

  it('is false for a supplier, a surname alone, and nothing', () => {
    expect(containsEmployeeName('BOOKER CASH AND CARRY', employees)).toBe(false)
    expect(containsEmployeeName('TREVITHICK BUTCHERS', employees)).toBe(false)
    expect(containsEmployeeName(null, employees)).toBe(false)
    expect(containsEmployeeName('MORWENNA TREVITHICK', [])).toBe(false)
  })
})
