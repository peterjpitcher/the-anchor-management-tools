import { describe, expect, it } from 'vitest'

import { marketingSendToEntry, type MarketingSendInput } from '../adapters'
import { entryTooltipText } from '../tooltip-text'
import { kindColor } from '../appearance'

function send(overrides: Partial<MarketingSendInput> = {}): MarketingSendInput {
  return {
    id: 'c1',
    name: 'September quiz night',
    subject: 'Quiz night is back',
    audience_type: 'customer',
    status: 'scheduled',
    // 10:30 London on a BST date (09:30 UTC).
    send_at: '2026-09-15T09:30:00Z',
    recipient_count: 412,
    ...overrides,
  }
}

describe('marketingSendToEntry', () => {
  it('places the send on its London day and time', () => {
    const entry = marketingSendToEntry(send())!

    expect(entry.kind).toBe('marketing_email')
    expect(entry.id).toBe('mkt:c1')
    expect(entry.title).toBe('September quiz night')
    expect(entry.color).toBe(kindColor('marketing_email'))
    expect(entry.start.getFullYear()).toBe(2026)
    expect(entry.start.getMonth()).toBe(8)
    expect(entry.start.getDate()).toBe(15)
    expect(entry.start.getHours()).toBe(10)
    expect(entry.start.getMinutes()).toBe(30)
    // A send is a moment; 30 minutes keeps it a readable block.
    expect(entry.end.getTime() - entry.start.getTime()).toBe(30 * 60 * 1000)
    expect(entry.allDay).toBe(false)
    expect(entry.onClickHref).toBe('/marketing/campaigns/c1')
  })

  it('does not drift across midnight for a late GMT send', () => {
    // 23:30 UTC in January is 23:30 London, so it must stay on the 14th rather
    // than sliding a day either way.
    const entry = marketingSendToEntry(send({ send_at: '2026-01-14T23:30:00Z' }))!

    expect(entry.start.getDate()).toBe(14)
    expect(entry.start.getHours()).toBe(23)
  })

  it('shows the approved audience size, and falls back to the audience name', () => {
    expect(marketingSendToEntry(send())!.subtitle).toBe('412 recipients')
    expect(marketingSendToEntry(send({ recipient_count: null }))!.subtitle).toBe('Guests')
    expect(
      marketingSendToEntry(send({ recipient_count: null, audience_type: 'business' }))!.subtitle,
    ).toBe('Business contacts')
    expect(
      marketingSendToEntry(send({ recipient_count: null, audience_type: 'nonsense' }))!.subtitle,
    ).toBe('Marketing list')
  })

  it('calls a finished campaign Sent, and keeps cancelled strikeable', () => {
    expect(marketingSendToEntry(send({ status: 'completed' }))!.statusLabel).toBe('Sent')
    expect(marketingSendToEntry(send({ status: 'sending' }))!.statusLabel).toBe('Sending')
    expect(marketingSendToEntry(send({ status: 'paused' }))!.statusLabel).toBe('Paused')

    const cancelled = marketingSendToEntry(send({ status: 'cancelled' }))!
    expect(cancelled.statusLabel).toBe('Cancelled')
    // The month grid and list both strike through on this exact value.
    expect(cancelled.status).toBe('cancelled')
  })

  it('returns null rather than an entry on a day it cannot place', () => {
    expect(marketingSendToEntry(send({ send_at: null }))).toBeNull()
    expect(marketingSendToEntry(send({ send_at: 'not a date' }))).toBeNull()
  })

  it('puts the subject and audience in the plain-text tooltip', () => {
    const text = entryTooltipText(marketingSendToEntry(send())!)

    expect(text).toContain('Marketing email: September quiz night')
    expect(text).toContain('Subject: Quiz night is back')
    expect(text).toContain('Guests')
    expect(text).toContain('412 recipients')
    expect(text).toContain('10:30')
  })
})
