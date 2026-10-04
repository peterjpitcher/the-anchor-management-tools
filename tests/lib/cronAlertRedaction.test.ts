import { describe, expect, it } from 'vitest'
import { redactPii } from '@/lib/cron/alerting'

// Alerts go to staff and must not carry a customer's phone number or email address. But the
// phone pattern used to read a record id or a date as a phone number, so "open this draft"
// links in alerts arrived broken about a third of the time.
describe('redactPii', () => {
  it('still removes phone numbers and email addresses', () => {
    expect(redactPii('Call 07990 587315 or +44 7990 587315')).toBe('Call [REDACTED_PHONE] or [REDACTED_PHONE]')
    expect(redactPii('Refused for sam@example.com')).toBe('Refused for [REDACTED_EMAIL]')
  })

  it('leaves record ids in links alone', () => {
    const link = 'https://management.example.test/invoices/18e42324-f9d1-4344-b431-82268a22834b'
    expect(redactPii(`Open the draft: ${link}`)).toBe(`Open the draft: ${link}`)
    // An id made only of digits is the case the phone pattern caught most often.
    const digits = '11112222-3333-4444-5555-666677778888'
    expect(redactPii(`/invoices/${digits}`)).toBe(`/invoices/${digits}`)
  })

  it('leaves calendar dates alone', () => {
    expect(redactPii('run: 2026-10-05')).toBe('run: 2026-10-05')
    expect(redactPii('Billed month 2026-10, pass started 2026-11-02')).toBe('Billed month 2026-10, pass started 2026-11-02')
  })

  it('handles ids, dates, phones and emails together', () => {
    const input = 'Invoice 18e42324-f9d1-4344-b431-82268a22834b on 2026-10-05: tell sam@example.com on 07990587315'
    expect(redactPii(input)).toBe(
      'Invoice 18e42324-f9d1-4344-b431-82268a22834b on 2026-10-05: tell [REDACTED_EMAIL] on [REDACTED_PHONE]'
    )
  })
})
