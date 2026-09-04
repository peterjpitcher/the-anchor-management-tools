import { describe, expect, it } from 'vitest'

import { interpretSendResult } from '../sendOutcome'

describe('interpretSendResult', () => {
  it('reports a normal send as sent and clears the draft', () => {
    const outcome = interpretSendResult({ success: true, status: 'queued' })
    expect(outcome.kind).toBe('sent')
    expect(outcome.tone).toBe('success')
    expect(outcome.clearsDraft).toBe(true)
  })

  it('never calls a quiet-hours deferral "sent"', () => {
    // The send path returns success: true for a message that will not go out
    // until the morning. Staff acted on "Message sent" and told customers they
    // had been replied to.
    const outcome = interpretSendResult({
      success: true,
      status: 'scheduled',
      deferred: true,
      scheduledFor: '2026-09-05T07:00:00.000Z',
    })
    expect(outcome.kind).toBe('scheduled')
    expect(outcome.tone).toBe('warning')
    expect(outcome.message).toContain('Scheduled, not sent yet')
    expect(outcome.message).toMatch(/8:00 am/)
  })

  it('still says scheduled when the time is missing or unparseable', () => {
    expect(interpretSendResult({ success: true, deferred: true }).message).toContain('Scheduled')
    expect(
      interpretSendResult({ success: true, deferred: true, scheduledFor: 'nonsense' }).message,
    ).toContain('Scheduled')
  })

  it('keeps the draft when the message was suppressed as a duplicate', () => {
    const outcome = interpretSendResult({ success: true, suppressed: true })
    expect(outcome.kind).toBe('suppressed')
    expect(outcome.clearsDraft).toBe(false)
  })

  it('warns when the message went but was not recorded', () => {
    const outcome = interpretSendResult({ success: true, logFailure: true })
    expect(outcome.kind).toBe('logged_failure')
    expect(outcome.tone).toBe('warning')
    expect(outcome.clearsDraft).toBe(true)
  })

  it('keeps the draft on every failure', () => {
    expect(interpretSendResult({ error: 'Insufficient permissions' }).clearsDraft).toBe(false)
    expect(interpretSendResult({ success: false }).clearsDraft).toBe(false)
    expect(interpretSendResult(null).clearsDraft).toBe(false)
    expect(interpretSendResult(undefined).clearsDraft).toBe(false)
  })

  it('surfaces the server error text rather than a generic one', () => {
    expect(interpretSendResult({ error: 'Customer has opted out of SMS messages' }).message).toBe(
      'Customer has opted out of SMS messages',
    )
  })
})
