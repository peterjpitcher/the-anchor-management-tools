import { afterEach, describe, expect, it } from 'vitest'
import {
  currentEmailSuspensionReason,
  resolveEmailSuspensionReason,
} from '@/lib/email/suspension'

describe('email suspension switches', () => {
  afterEach(() => {
    delete process.env.SUSPEND_ALL_EMAIL
    delete process.env.SUSPEND_ALL_COMMS
  })

  it('is off when neither switch is set, or when both read false', () => {
    expect(resolveEmailSuspensionReason({})).toBe(null)
    expect(resolveEmailSuspensionReason({ suspendAllEmail: 'false', suspendAllComms: 'false' })).toBe(null)
    expect(resolveEmailSuspensionReason({ suspendAllEmail: '', suspendAllComms: '0' })).toBe(null)
  })

  it('stops email on either switch, reporting SUSPEND_ALL_COMMS first', () => {
    expect(resolveEmailSuspensionReason({ suspendAllEmail: 'true' })).toBe('all_email')
    expect(resolveEmailSuspensionReason({ suspendAllComms: 'yes' })).toBe('all_comms')
    expect(resolveEmailSuspensionReason({ suspendAllEmail: 'true', suspendAllComms: 'on' })).toBe('all_comms')
  })

  it('reads the environment at call time', () => {
    expect(currentEmailSuspensionReason()).toBe(null)

    process.env.SUSPEND_ALL_EMAIL = 'TRUE'
    expect(currentEmailSuspensionReason()).toBe('all_email')

    process.env.SUSPEND_ALL_COMMS = '1'
    expect(currentEmailSuspensionReason()).toBe('all_comms')
  })
})
