import { describe, expect, it } from 'vitest'
import {
  resolveOnboardingSessionError,
  SIGN_IN_REQUIRED_MESSAGE,
  WRONG_ACCOUNT_MESSAGE,
} from '@/lib/employees/onboarding-session'

const EMPLOYEE_USER = '11111111-1111-1111-1111-111111111111'
const SOMEONE_ELSE = '22222222-2222-2222-2222-222222222222'

describe('resolveOnboardingSessionError', () => {
  it('asks a starter who already has a password to sign in when there is no session', () => {
    // Spec v2: once the account exists a forwarded link must stop working on its own. The normal
    // path never reaches this, because createEmployeeAccount signs the browser in; someone coming
    // back on another device does, and signs in on the onboarding page to carry on.
    expect(resolveOnboardingSessionError({
      employeeAuthUserId: EMPLOYEE_USER,
      sessionUserId: null,
    })).toEqual({ code: 'sign_in_required', message: SIGN_IN_REQUIRED_MESSAGE })
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
    // The link forwarded to a colleague who is already signed in on a shared device.
    expect(resolveOnboardingSessionError({
      employeeAuthUserId: EMPLOYEE_USER,
      sessionUserId: SOMEONE_ELSE,
    })).toEqual({ code: 'wrong_account', message: WRONG_ACCOUNT_MESSAGE })
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
