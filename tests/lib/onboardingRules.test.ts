import { describe, expect, it } from 'vitest'
import {
  isEmergencyContactsComplete,
  isFinancialComplete,
  isMaskedValue,
  isPersonalComplete,
  maskTail,
} from '@/lib/employees/onboarding-rules'
import { passwordError, PASSWORD_MIN_LENGTH } from '@/lib/employees/password-rule'
import { inviteTokenProblem } from '@/lib/employees/invite-token-rules'

describe('onboarding section completeness', () => {
  it('needs a name and an accepted date of birth for personal details', () => {
    expect(isPersonalComplete({ first_name: 'Sam', last_name: 'Reed', date_of_birth: '1990-05-01' })).toBe(true)
    expect(isPersonalComplete({ first_name: 'Sam', last_name: 'Reed', date_of_birth: null })).toBe(false)
    expect(isPersonalComplete({ first_name: 'Sam', last_name: 'Reed', date_of_birth: '1990-02-30' })).toBe(false)
    expect(isPersonalComplete({ first_name: '  ', last_name: 'Reed', date_of_birth: '1990-05-01' })).toBe(false)
    expect(isPersonalComplete(null)).toBe(false)
  })

  it('needs a name and a number for the main emergency contact', () => {
    expect(isEmergencyContactsComplete({ name: 'Jo', phone_number: null, mobile_number: '+447700900123' })).toBe(true)
    expect(isEmergencyContactsComplete({ name: 'Jo', phone_number: '+441753682707', mobile_number: '' })).toBe(true)
    expect(isEmergencyContactsComplete({ name: 'Jo', phone_number: '', mobile_number: '  ' })).toBe(false)
    expect(isEmergencyContactsComplete({ name: '', phone_number: '+441753682707' })).toBe(false)
    expect(isEmergencyContactsComplete(null)).toBe(false)
  })

  it('needs a sort code and account number, counts a masked account number, and does not need NI', () => {
    expect(isFinancialComplete({ bank_sort_code: '11-22-33', bank_account_number: '12345678' })).toBe(true)
    expect(isFinancialComplete({ bank_sort_code: '11-22-33', bank_account_number: '••••5678' })).toBe(true)
    expect(isFinancialComplete({ bank_sort_code: '', bank_account_number: '12345678' })).toBe(false)
    expect(isFinancialComplete({ bank_sort_code: '11-22-33', bank_account_number: null })).toBe(false)
    expect(isFinancialComplete(null)).toBe(false)
  })
})

describe('masking', () => {
  it('keeps only the tail, and round trips as a mask', () => {
    expect(maskTail('QQ123456C', 3)).toBe('••••••56C')
    expect(maskTail('12345678', 4)).toBe('••••5678')
    expect(maskTail('', 4)).toBe('')
    expect(isMaskedValue(maskTail('QQ123456C', 3))).toBe(true)
    expect(isMaskedValue('QQ123456C')).toBe(false)
    // A half-edited mask is not the mask the server sent.
    expect(isMaskedValue('••12•5678')).toBe(false)
  })
})

describe('starter password rule', () => {
  it(`needs at least ${PASSWORD_MIN_LENGTH} characters`, () => {
    expect(passwordError('a'.repeat(11))).toMatch(/at least 12 characters/)
    expect(passwordError('')).toMatch(/at least 12 characters/)
    expect(passwordError('a'.repeat(12))).toBeNull()
  })

  it('refuses more than 72 bytes rather than letting bcrypt cut it short', () => {
    expect(passwordError('a'.repeat(72))).toBeNull()
    expect(passwordError('a'.repeat(73))).toMatch(/too long/)
    // 25 three-byte characters is 75 bytes but only 25 characters.
    expect(passwordError('€'.repeat(25))).toMatch(/too long/)
  })
})

describe('invite link rules', () => {
  const employee = { email_address: 'Starter@Example.com', status: 'Onboarding', auth_user_id: null }

  it('accepts an onboarding link for the same email, in any case, while still Onboarding', () => {
    expect(inviteTokenProblem({ inviteType: 'onboarding', tokenEmail: ' starter@example.com ', employee })).toBeNull()
  })

  it('refuses a link whose employee email has changed', () => {
    expect(inviteTokenProblem({ inviteType: 'onboarding', tokenEmail: 'old@example.com', employee })).toBe('email_changed')
  })

  it('refuses an onboarding link once the employee is no longer Onboarding', () => {
    expect(inviteTokenProblem({
      inviteType: 'onboarding', tokenEmail: 'starter@example.com', employee: { ...employee, status: 'Active' },
    })).toBe('onboarding_finished')
  })

  it('only lets a current employee without a login use a portal link', () => {
    const active = { ...employee, status: 'Active' }
    expect(inviteTokenProblem({ inviteType: 'portal_access', tokenEmail: 'starter@example.com', employee: active })).toBeNull()
    expect(inviteTokenProblem({
      inviteType: 'portal_access', tokenEmail: 'starter@example.com', employee: { ...active, status: 'Former' },
    })).toBe('not_active')
    expect(inviteTokenProblem({
      inviteType: 'portal_access', tokenEmail: 'starter@example.com', employee: { ...active, auth_user_id: 'auth-1' },
    })).toBe('has_login')
  })
})
