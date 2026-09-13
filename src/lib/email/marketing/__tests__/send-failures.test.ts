import { describe, expect, it } from 'vitest'
import { classifySendFailure } from '../send-failures'

describe('classifySendFailure', () => {
  it('holds a recipient back when the email kill switch refused the send', () => {
    expect(classifySendFailure('Email sending is currently suspended', 'email_suspended')).toBe('retryable')
  })

  it('lets the code win over a message that would otherwise read as terminal', () => {
    // "suppressed" matches a terminal pattern; the code says nothing about this recipient.
    expect(classifySendFailure('Recipient email address is suppressed', 'email_suspended')).toBe('retryable')
  })

  it('classifies by message alone when there is no code, as before', () => {
    expect(classifySendFailure('Recipient email address is suppressed')).toBe('terminal')
    expect(classifySendFailure('Recipient email address is suppressed', null)).toBe('terminal')
    expect(classifySendFailure('503 Service Unavailable')).toBe('retryable')
    expect(classifySendFailure('Something new and unexplained')).toBe('retryable')
  })
})
