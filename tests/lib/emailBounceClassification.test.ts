import { describe, expect, it } from 'vitest'
import {
  bounceShouldSuppress,
  classifyBounceSeverity,
} from '@/lib/email/bounce-classification'
import {
  emailAddressResetFields,
  isEmailAddressChange,
} from '@/lib/email/address-reset'

describe('classifyBounceSeverity', () => {
  it('treats a permanent bounce as permanent', () => {
    expect(classifyBounceSeverity({ type: 'Permanent', subType: 'General' })).toBe('permanent')
    expect(bounceShouldSuppress({ type: 'Permanent', subType: 'General' })).toBe(true)
  })

  // The two shapes that made up all 10 temporary bounces in the 120 days to 12 September
  // 2026, and all 10 were blocked for ever by the old code.
  it('treats a full inbox as temporary', () => {
    expect(
      classifyBounceSeverity({
        type: 'Transient',
        subType: 'MailboxFull',
        message: "The recipient's inbox was full",
      })
    ).toBe('transient')
  })

  it('treats a general transient bounce as temporary', () => {
    expect(
      classifyBounceSeverity({
        type: 'Transient',
        subType: 'General',
        message: 'This is a general bounce, you might be able to send a message to the same recipient later',
      })
    ).toBe('transient')
  })

  it('does not suppress on a full inbox even when the sub-type is missing', () => {
    expect(bounceShouldSuppress({ message: 'The mailbox is full' })).toBe(false)
  })

  it('reads an undetermined bounce as temporary rather than guessing against the guest', () => {
    expect(classifyBounceSeverity({ type: 'Undetermined' })).toBe('transient')
  })

  it('reads a dead mailbox from the wording when the provider sends no type', () => {
    expect(classifyBounceSeverity({ message: 'Recipient address rejected: user unknown' })).toBe('permanent')
    expect(classifyBounceSeverity({ message: 'That mailbox does not exist' })).toBe('permanent')
  })

  it('treats a nameless bounce as temporary', () => {
    expect(classifyBounceSeverity(undefined)).toBe('transient')
    expect(classifyBounceSeverity(null)).toBe('transient')
    expect(classifyBounceSeverity({})).toBe('transient')
  })

  it('treats a provider suppression sub-type as permanent whatever the type says', () => {
    expect(classifyBounceSeverity({ type: 'Transient', subType: 'Suppressed' })).toBe('permanent')
    expect(classifyBounceSeverity({ type: 'Transient', subType: 'NoEmail' })).toBe('permanent')
  })

  it('ignores the case the provider happens to use', () => {
    expect(classifyBounceSeverity({ type: 'PERMANENT' })).toBe('permanent')
    expect(classifyBounceSeverity({ type: 'transient', subType: 'mailboxfull' })).toBe('transient')
  })
})

describe('email address reset', () => {
  it('clears the deactivation as well as the status', () => {
    // The deactivation stamp is the field `isEmailUsable` actually reads, and the one the
    // capture link used to leave behind.
    expect(emailAddressResetFields()).toEqual({
      email_status: 'unknown',
      email_deactivated_at: null,
      email_delivery_failures: 0,
      last_email_failure_reason: null,
    })
  })

  it('does not claim the new address works', () => {
    expect(emailAddressResetFields().email_status).toBe('unknown')
  })

  it('spots a real change of address', () => {
    expect(isEmailAddressChange('old@example.com', 'new@example.com')).toBe(true)
    expect(isEmailAddressChange(null, 'new@example.com')).toBe(true)
    expect(isEmailAddressChange('old@example.com', null)).toBe(true)
  })

  it('does not treat recasing or padding as a new mailbox', () => {
    expect(isEmailAddressChange('Guest@Example.com', 'guest@example.com')).toBe(false)
    expect(isEmailAddressChange('guest@example.com', '  guest@example.com  ')).toBe(false)
    expect(isEmailAddressChange(null, null)).toBe(false)
  })
})
