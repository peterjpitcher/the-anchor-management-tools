import { describe, expect, it } from 'vitest'

import {
  classifyMarketingClicks,
  type MarketingClickRow,
} from '../attribution'

const LINKS = ['home', 'event', 'whatsapp', 'facebook', 'instagram']

function click(
  link: string,
  seconds: number,
  overrides: Partial<MarketingClickRow> = {},
): MarketingClickRow {
  return {
    short_link_id: link,
    utm_content: 'recipient-1',
    clicked_at: new Date(Date.parse('2026-08-17T10:50:00Z') + seconds * 1000).toISOString(),
    device_type: 'desktop',
    ...overrides,
  }
}

describe('classifyMarketingClicks', () => {
  it('keeps an ordinary customer clicking one or two links', () => {
    const rows = [click('event', 60), click('whatsapp', 110)]

    const result = classifyMarketingClicks(rows, LINKS)

    expect(result.humanRows).toEqual(rows)
    expect(result.filteredRows).toEqual([])
  })

  it('filters a scanner that rapidly sweeps most links with a normal browser user agent', () => {
    const rows = [
      click('home', 1),
      click('event', 1.2),
      click('whatsapp', 1.4),
      click('facebook', 1.6),
    ]

    const result = classifyMarketingClicks(rows, LINKS)

    expect(result.humanRows).toEqual([])
    expect(result.filteredRows).toHaveLength(4)
  })

  it('filters a slower scan when it repeats links across most of the message', () => {
    const rows = [
      click('home', 1),
      click('event', 20),
      click('whatsapp', 40),
      click('facebook', 60),
      click('home', 80),
      click('event', 100),
    ]

    const result = classifyMarketingClicks(rows, LINKS)

    expect(result.humanRows).toEqual([])
    expect(result.filteredRows).toHaveLength(6)
  })

  it('keeps a later isolated customer click after filtering an earlier scan session', () => {
    const scan = [
      click('home', 1),
      click('event', 1.2),
      click('whatsapp', 1.4),
      click('facebook', 1.6),
    ]
    const laterCustomerClick = click('event', 10 * 60)

    const result = classifyMarketingClicks([...scan, laterCustomerClick], LINKS)

    expect(result.humanRows).toEqual([laterCustomerClick])
    expect(result.filteredRows).toEqual(scan)
  })

  it('filters known bots even when there are too few links for behaviour detection', () => {
    const bot = click('event', 60, { device_type: 'bot', utm_content: null })

    const result = classifyMarketingClicks([bot], ['event'])

    expect(result.humanRows).toEqual([])
    expect(result.filteredRows).toEqual([bot])
  })

  it('filters test activity before the campaign send time', () => {
    const beforeSend = click('event', -60)
    const afterSend = click('event', 60)

    const result = classifyMarketingClicks([beforeSend, afterSend], LINKS, {
      notBefore: '2026-08-17T10:50:00Z',
    })

    expect(result.humanRows).toEqual([afterSend])
    expect(result.filteredRows).toEqual([beforeSend])
  })

  it('does not guess when an unclassified click has no usable timestamp', () => {
    const row = click('event', 60, { clicked_at: null, device_type: null })

    const result = classifyMarketingClicks([row], LINKS)

    expect(result.humanRows).toEqual([row])
    expect(result.filteredRows).toEqual([])
  })
})
