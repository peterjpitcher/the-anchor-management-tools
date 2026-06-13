import { describe, expect, it } from 'vitest'

import { EVENT_MARKETING_CHANNELS, buildEventMarketingLinkPayload } from '@/lib/event-marketing-links'
import { ALL_CHANNELS } from '@/lib/short-links/channels'

describe('event marketing links', () => {
  it('keeps event marketing options aligned with short-link channel options', () => {
    const eventKeys = new Set(EVENT_MARKETING_CHANNELS.map(channel => channel.key))

    for (const channel of ALL_CHANNELS) {
      const eventKey = channel.key === 'google_business' ? 'google_business_profile' : channel.key
      expect(eventKeys.has(eventKey)).toBe(true)
    }
  })

  it('includes pub-specific QR placements in both shared and event marketing options', () => {
    const sharedKeys = new Set(ALL_CHANNELS.map(channel => channel.key))
    const eventKeys = new Set(EVENT_MARKETING_CHANNELS.map(channel => channel.key))

    for (const key of [
      'beer_mat',
      'staff_badge',
      'toilet_poster',
      'a_board',
      'bar_top_display',
      'bill_presenter',
      'kids_activity_sheet',
      'loyalty_card',
      'wifi_card',
      'private_hire_pack',
      'partner_poster',
      'event_host_slide',
      'pre_event_screen',
      'post_event_screen',
    ]) {
      expect(sharedKeys.has(key)).toBe(true)
      expect(eventKeys.has(key)).toBe(true)
    }
  })


  it('builds Facebook UTMs for events', () => {
    const channel = EVENT_MARKETING_CHANNELS.find((item) => item.key === 'facebook')
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
      utm_source: 'facebook',
      utm_medium: 'social',
      utm_campaign: 'event-spring-wine-tasting',
      utm_content: 'facebook_main',
      utm_term: 'facebook',
    })

    const url = new URL(payload.destinationUrl)
    expect(url.origin).toBe('https://www.the-anchor.pub')
    expect(url.pathname).toBe('/events/spring-wine-tasting')
    expect(url.searchParams.get('utm_source')).toBe('facebook')
    expect(url.searchParams.get('utm_medium')).toBe('social')
    expect(url.searchParams.get('utm_campaign')).toBe('event-spring-wine-tasting')
    expect(url.searchParams.get('utm_content')).toBe('facebook_main')
    expect(url.searchParams.get('utm_term')).toBe('facebook')
  })

  it('ignores event booking_url for marketing destinations', () => {
    const channel = EVENT_MARKETING_CHANNELS.find((item) => item.key === 'facebook')
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
    expect(url.searchParams.get('utm_source')).toBe('facebook')
    expect(url.searchParams.get('utm_medium')).toBe('social')
    expect(url.searchParams.get('utm_campaign')).toBe('event-spring-wine-tasting')
    expect(url.searchParams.get('utm_content')).toBe('facebook_main')
    expect(url.searchParams.get('utm_term')).toBe('facebook')
  })

  it('builds printed menu QR tracking separately from other print placements', () => {
    const channel = EVENT_MARKETING_CHANNELS.find((item) => item.key === 'printed_menu')
    expect(channel).toBeTruthy()

    const payload = buildEventMarketingLinkPayload(
      {
        id: '123e4567-e89b-12d3-a456-426614174000',
        slug: 'music-bingo',
        name: 'Music Bingo',
        date: '2026-05-08',
      },
      channel!
    )

    expect(payload.utm).toEqual({
      utm_source: 'printed_menu',
      utm_medium: 'print',
      utm_campaign: 'event-music-bingo',
      utm_content: 'printed_menu_qr',
      utm_term: 'printed_menu',
    })
    expect(payload.shortCode).toMatch(/^mn/)
  })

  it('builds in-game screen QR tracking with screen medium', () => {
    const channel = EVENT_MARKETING_CHANNELS.find((item) => item.key === 'in_game_screen')
    expect(channel).toBeTruthy()

    const payload = buildEventMarketingLinkPayload(
      {
        id: '123e4567-e89b-12d3-a456-426614174000',
        slug: 'quiz-night',
        name: 'Quiz Night',
        date: '2026-05-15',
      },
      channel!
    )

    expect(payload.utm).toEqual({
      utm_source: 'in_game_screen',
      utm_medium: 'screen',
      utm_campaign: 'event-quiz-night',
      utm_content: 'in_game_screen_qr',
      utm_term: 'in_game_screen',
    })
    expect(payload.shortCode).toMatch(/^sc/)
  })
})
