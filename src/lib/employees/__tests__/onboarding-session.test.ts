import { describe, expect, it } from 'vitest'
import { resolveOnboardingSessionError } from '@/lib/employees/onboarding-session'

const EMPLOYEE_USER = '11111111-1111-1111-1111-111111111111'
const SOMEONE_ELSE = '22222222-2222-2222-2222-222222222222'

describe('resolveOnboardingSessionError', () => {
  it('allows a starter who has just created a password and has no browser session', () => {
    // The regression this exists to prevent. createEmployeeAccount makes the auth user with the
    // admin client and links it to the employee, but never signs the browser in, so from the
    // password step onwards auth_user_id is set while sessionUserId is null. Refusing that
    // combination blocked every step after the password for every new starter.
    expect(resolveOnboardingSessionError({
      employeeAuthUserId: EMPLOYEE_USER,
      sessionUserId: null,
    })).toBeNull()
  })

  it('allows a starter before they have created an account at all', () => {
    expect(resolveOnboardingSessionError({
      employeeAuthUserId: null,
      sessionUserId: null,
    })).toBeNull()
  })

  it('allows the employee when they are signed in as themselves', () => {
    expect(resolveOnboardingSessionError({
      employeeAuthUserId: EMPLOYEE_USER,
      sessionUserId: EMPLOYEE_USER,
    })).toBeNull()
  })

  it('refuses a link opened by a different signed in user', () => {
    // The case the check was written for: the link forwarded to a colleague who is already
    // signed in on a shared device.
    expect(resolveOnboardingSessionError({
      employeeAuthUserId: EMPLOYEE_USER,
      sessionUserId: SOMEONE_ELSE,
    })).toBe('This onboarding link belongs to a different account. Please sign out and open the link again.')
  })

  it('does not refuse a signed in user when the starter has no account yet', () => {
    // A manager signed in on the same browser opening a brand new invite should not be blocked,
    // because there is no account to mismatch against yet.
    expect(resolveOnboardingSessionError({
      employeeAuthUserId: null,
      sessionUserId: SOMEONE_ELSE,
    })).toBeNull()
  })
})
