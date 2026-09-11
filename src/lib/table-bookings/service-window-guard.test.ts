import { describe, expect, it } from 'vitest'
import { extractServiceWindowRuleErrorMessage } from './service-window-guard'

// The exact sentence table_bookings_service_window_guard raised in production on 9 September
// 2026 (migration 20260815190000), when seven walk-ins in a row were refused.
const GUARD_MESSAGE =
  'The kitchen is not serving at 20:34 on 09 Sep 2026. Please choose a time inside a food service.'

describe('extractServiceWindowRuleErrorMessage', () => {
  it('returns the guard sentence from a PostgREST error', () => {
    expect(
      extractServiceWindowRuleErrorMessage({ code: '22023', message: GUARD_MESSAGE, details: null, hint: null }),
    ).toBe(GUARD_MESSAGE)
  })

  it('still recognises the sentence once it has been rewrapped without its code', () => {
    expect(extractServiceWindowRuleErrorMessage(new Error(GUARD_MESSAGE))).toBe(GUARD_MESSAGE)
  })

  it('ignores the same wording under a different SQLSTATE', () => {
    expect(extractServiceWindowRuleErrorMessage({ code: 'P0001', message: GUARD_MESSAGE })).toBeNull()
  })

  it('ignores every other failure', () => {
    expect(
      extractServiceWindowRuleErrorMessage({ code: '22023', message: 'Christmas bookings are for 4 guests or more.' }),
    ).toBeNull()
    expect(extractServiceWindowRuleErrorMessage({ code: '23P01', message: 'table_assignment_overlap' })).toBeNull()
    expect(extractServiceWindowRuleErrorMessage({ message: '' })).toBeNull()
    expect(extractServiceWindowRuleErrorMessage(GUARD_MESSAGE)).toBeNull()
    expect(extractServiceWindowRuleErrorMessage(null)).toBeNull()
    expect(extractServiceWindowRuleErrorMessage(undefined)).toBeNull()
  })
})
