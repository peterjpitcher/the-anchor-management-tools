import { describe, expect, it } from 'vitest'

import { EVENT_MARKETING_CHANNELS, buildEventMarketingLinkPayload } from '@/lib/event-marketing-links'

describe('event marketing links', () => {
  it('builds OpenTable UTMs for events', () => {
    const channel = EVENT_MARKETING_CHANNELS.find((item) => item.key === 'opentable')
    expect(channel).toBeTruthy()

    const payload = buildEventMarketingLinkPayload(
      {
        id: '123e4567-e89b-12d3-a456-426614174000',
        slug: 'spring-wine-tasting',
        name: 'Spring Wine Tasting',
        date: '2026-04-19',
      },
      channel!
    )

    expect(payload.utm).toEqual({
      utm_source: 'opentable',
      utm_medium: 'reservation_platform',
      utm_campaign: 'event-spring-wine-tasting',
      utm_content: 'opentable_experience',
      utm_term: 'opentable',
    })

    const url = new URL(payload.destinationUrl)
    expect(url.origin).toBe('https://www.the-anchor.pub')
    expect(url.pathname).toBe('/events/spring-wine-tasting')
    expect(url.searchParams.get('utm_source')).toBe('opentable')
    expect(url.searchParams.get('utm_medium')).toBe('reservation_platform')
    expect(url.searchParams.get('utm_campaign')).toBe('event-spring-wine-tasting')
    expect(url.searchParams.get('utm_content')).toBe('opentable_experience')
    expect(url.searchParams.get('utm_term')).toBe('opentable')
  })

  it('ignores event booking_url for marketing destinations', () => {
    const channel = EVENT_MARKETING_CHANNELS.find((item) => item.key === 'opentable')
    expect(channel).toBeTruthy()

    const payload = buildEventMarketingLinkPayload(
      {
        id: '123e4567-e89b-12d3-a456-426614174000',
        slug: 'spring-wine-tasting',
        name: 'Spring Wine Tasting',
        date: '2026-04-19',
        booking_url: 'https://example.com/booking?foo=bar',
      } as any,
      channel!
    )

    const url = new URL(payload.destinationUrl)
    expect(url.origin).toBe('https://www.the-anchor.pub')
    expect(url.pathname).toBe('/events/spring-wine-tasting')
    expect(url.searchParams.get('foo')).toBe(null)
    expect(url.searchParams.get('utm_source')).toBe('opentable')
    expect(url.searchParams.get('utm_medium')).toBe('reservation_platform')
    expect(url.searchParams.get('utm_campaign')).toBe('event-spring-wine-tasting')
    expect(url.searchParams.get('utm_content')).toBe('opentable_experience')
    expect(url.searchParams.get('utm_term')).toBe('opentable')
  })
})
