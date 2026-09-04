import { describe, expect, it } from 'vitest'

import {
  getReplyEligibility,
  getSmsConsentState,
  SMS_CONSENT_LABEL,
} from '../replyEligibility'

const optedIn = { mobile_number: '07123456789', sms_opt_in: true }

describe('getReplyEligibility', () => {
  it('allows a reply and names the destination when everything is in place', () => {
    const result = getReplyEligibility(optedIn, { canSend: true })
    expect(result).toEqual({ canReply: true, destination: '07123456789' })
  })

  it('blocks a user whose role cannot send, ahead of any customer check', () => {
    const result = getReplyEligibility(optedIn, { canSend: false })
    expect(result.canReply).toBe(false)
    if (!result.canReply) expect(result.reason).toBe('no_permission')
  })

  it('blocks an explicit opt-out', () => {
    const result = getReplyEligibility({ ...optedIn, sms_opt_in: false }, { canSend: true })
    expect(result.canReply).toBe(false)
    if (!result.canReply) expect(result.reason).toBe('opted_out')
  })

  it('treats null consent as unknown, not as consent', () => {
    // MessageService.sendReply throws on a null opt-in, so a composer that
    // accepted this was inviting a message the server would always reject.
    const result = getReplyEligibility({ ...optedIn, sms_opt_in: null }, { canSend: true })
    expect(result.canReply).toBe(false)
    if (!result.canReply) expect(result.reason).toBe('consent_unknown')
  })

  it('blocks when there is no mobile number to send to', () => {
    const result = getReplyEligibility({ mobile_number: '   ', sms_opt_in: true }, { canSend: true })
    expect(result.canReply).toBe(false)
    if (!result.canReply) expect(result.reason).toBe('no_mobile_number')
  })

  it('blocks when there is no customer loaded at all', () => {
    expect(getReplyEligibility(null, { canSend: true }).canReply).toBe(false)
  })

  it('always gives a reason a member of staff can act on', () => {
    const blocked = getReplyEligibility({ mobile_number: null, sms_opt_in: null }, { canSend: true })
    expect(blocked.canReply).toBe(false)
    if (!blocked.canReply) {
      expect(blocked.title.length).toBeGreaterThan(0)
      expect(blocked.detail.length).toBeGreaterThan(0)
    }
  })
})

describe('getSmsConsentState', () => {
  it('separates not-recorded from opted-in', () => {
    expect(getSmsConsentState(true)).toBe('opted_in')
    expect(getSmsConsentState(false)).toBe('opted_out')
    expect(getSmsConsentState(null)).toBe('not_recorded')
    expect(getSmsConsentState(undefined)).toBe('not_recorded')
  })

  it('never labels unknown consent as opted in', () => {
    expect(SMS_CONSENT_LABEL[getSmsConsentState(null)]).toBe('Not recorded')
  })
})
