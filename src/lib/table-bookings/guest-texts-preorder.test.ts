import { describe, expect, it } from 'vitest'
import { countSmsSegments, isGsm7 } from '@/lib/sms/gsm7'
import { buildPreorderReminderText } from './guest-texts'

/**
 * BK-056: the pre-order chase text said "Every guest needs a main course." while the email said
 * 3 course guests need all three and 2 course guests a main and one other. A guest who only got the
 * text was told a main alone would do, and was chased again when the kitchen was short.
 */
describe('buildPreorderReminderText', () => {
  const text = buildPreorderReminderText({
    firstName: 'Bartholomew',
    bookingDate: '2026-12-12',
    bookingTime: '19:30',
    manageLink: 'https://l.the-anchor.pub/abc123',
  })

  it('states the tier rule, not a main for every guest', () => {
    expect(text).not.toContain('Every guest needs a main course')
    expect(text).toContain('Guests on 2 or 3 courses need every course chosen.')
    expect(text).toBe(
      'The Anchor: Bartholomew, we still need the food choices for your booking on Saturday 12 December at 7:30pm. ' +
        'Guests on 2 or 3 courses need every course chosen. Choose here: https://l.the-anchor.pub/abc123',
    )
  })

  it('stays plain GSM-7 and within two segments with a long name and a full link', () => {
    const long = buildPreorderReminderText({
      firstName: 'Maximilianus',
      bookingDate: '2026-11-25',
      bookingTime: '18:45',
      manageLink: 'https://management.orangejelly.co.uk/g/0123456789abcdef0123456789abcdef/table-manage',
    })
    expect(isGsm7(long)).toBe(true)
    expect(countSmsSegments(long)).toBeLessThanOrEqual(2)
  })
})
