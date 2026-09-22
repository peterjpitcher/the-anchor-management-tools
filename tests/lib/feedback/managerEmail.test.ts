import { describe, expect, it } from 'vitest'

import { buildManagerFeedbackEmail } from '@/lib/feedback/manager-email'
import { assertCleanText } from '../../mocks/emailRenderChecks'

/**
 * The email the manager gets when a guest leaves feedback on the review page. Rendered with
 * fixture data: no broken values, no banned en or em dash, and a missing field reads
 * "Not provided" rather than a lone dash.
 */

// Thursday 1 October 2026, 7:30pm in London.
const SUBMITTED_AT = new Date('2026-10-01T18:30:00.000Z')

describe('manager feedback email', () => {
  it('lists the rating, comments and contact details the guest gave', () => {
    const email = buildManagerFeedbackEmail({
      rating: 5,
      comments: 'Lovely Sunday lunch',
      customerName: 'Pat Taylor',
      customerEmail: 'pat@example.com',
      customerPhone: '07700 900123',
      contactConsent: true,
      submittedAt: SUBMITTED_AT,
    })

    expect(email.subject).toBe('New guest feedback (The Anchor)')
    expect(email.html).toContain('<strong>Rating:</strong> 5 / 5')
    expect(email.html).toContain('<strong>Comments:</strong> Lovely Sunday lunch')
    expect(email.html).toContain('<strong>Name:</strong> Pat Taylor')
    assertCleanText(email.subject)
    assertCleanText(email.html)
  })

  it('says "Not provided" for each field the guest left blank', () => {
    const email = buildManagerFeedbackEmail({
      rating: 3,
      comments: '  ',
      customerName: 'Pat Taylor',
      customerEmail: null,
      customerPhone: undefined,
      contactConsent: true,
      submittedAt: SUBMITTED_AT,
    })

    expect(email.html).toContain('<strong>Comments:</strong> Not provided</li>')
    expect(email.html).toContain('<strong>Email:</strong> Not provided</li>')
    expect(email.html).toContain('<strong>Phone:</strong> Not provided</li>')
    assertCleanText(email.html)
  })

  it('leaves contact details out when the guest did not agree to be contacted', () => {
    const email = buildManagerFeedbackEmail({
      rating: 2,
      comments: 'Slow service',
      customerEmail: 'pat@example.com',
      contactConsent: false,
      submittedAt: SUBMITTED_AT,
    })

    expect(email.html).toContain('<p>Guest did not leave contact details.</p>')
    expect(email.html).not.toContain('pat@example.com')
    assertCleanText(email.html)
  })
})
