import { describe, expect, it } from 'vitest'

import {
  MergeError,
  SAMPLE_MERGE_FIELDS,
  bookingPartySize,
  mergeCampaignContent,
  mergeTokensIn,
  resolveMergeValues,
} from '../merge'
import type { MarketingContent } from '../registry'
import { applyDeliveryTransforms, renderMarketingEmail } from '../render'

const CONTENT = {
  title: 'Come back soon',
  preheader: 'Your voucher is inside',
  blocks: [
    {
      type: 'voucher_card',
      data: {
        kicker: 'Your voucher',
        headline: '{{voucher_percent}}% off your food',
        first_name: '{{first_name|}}',
        number: '{{voucher_number}}',
        expiry_date: '{{voucher_expires_on}}',
        how_to_use: 'Book a table, then show this email at the bar.',
        conditions: [
          '{{voucher_percent}}% off food for the booked table, in one visit.',
          'Drinks are not included.',
          'Not valid with the Christmas menu or special occasion menus.',
          'Advance booking is required.',
          'One voucher per table.',
          'Cannot be used with any other offer.',
        ],
      },
    },
  ],
} as unknown as MarketingContent

const FIELDS = {
  first_name: 'Sam',
  party_size: 3,
  voucher_number: 'AN-2611-0042',
  voucher_percent: 10,
  voucher_expires_on: '2026-12-11',
}

describe('merge values', () => {
  it('formats the expiry with its day name, in London', () => {
    expect(resolveMergeValues(FIELDS).voucher_expires_on).toBe('Friday 11 December 2026')
  })

  it('treats a placeholder name as no name', () => {
    expect(resolveMergeValues({ ...FIELDS, first_name: 'Guest' }).first_name).toBe('')
    expect(resolveMergeValues({ ...FIELDS, first_name: '   ' }).first_name).toBe('')
  })

  it.each([
    ['a voucher number that is not a ledger number', { voucher_number: 'undefined' }],
    ['an expiry that is not a date', { voucher_expires_on: '2026-02-31x' }],
    ['a percentage that is not whole', { voucher_percent: 'NaN' }],
  ])('refuses %s', (_label, override) => {
    expect(() => resolveMergeValues({ ...FIELDS, ...override })).toThrow(MergeError)
  })

  it('clamps the party size to the website range', () => {
    expect(bookingPartySize({ party_size: 25 })).toBe(20)
    expect(bookingPartySize({ party_size: 0 })).toBeNull()
    expect(bookingPartySize({ party_size: null })).toBeNull()
    expect(bookingPartySize({ party_size: 4 })).toBe(4)
  })
})

describe('mergeCampaignContent', () => {
  it('fills every token and renders a clean email', () => {
    const merged = mergeCampaignContent(CONTENT, FIELDS)
    const { html, text } = renderMarketingEmail(merged, { unsubscribeUrl: 'https://example.test/u' })

    for (const output of [html, text]) {
      expect(output).not.toMatch(/\{\{|\}\}|undefined|Invalid Date|NaN/)
      expect(output).toContain('AN-2611-0042')
      expect(output).toContain('Friday 11 December 2026')
      expect(output).toContain('10% off your food')
    }
    expect(html).toContain('For Sam&rsquo;s table')
  })

  it('drops the name row instead of greeting nobody', () => {
    const merged = mergeCampaignContent(CONTENT, { ...FIELDS, first_name: '' })
    const { html } = renderMarketingEmail(merged, { unsubscribeUrl: 'https://example.test/u' })
    expect(html).not.toContain('&rsquo;s table')
  })

  it('uses the fallback for an empty name', () => {
    const content = { ...CONTENT, blocks: [{ type: 'text_block', data: { text: 'Hi {{first_name|there}},' } }] }
    const merged = mergeCampaignContent(content as unknown as MarketingContent, { ...FIELDS, first_name: null })
    expect(JSON.stringify(merged)).toContain('Hi there,')
  })

  it('refuses to send a voucher email without a voucher', () => {
    expect(() => mergeCampaignContent(CONTENT, { first_name: 'Sam' })).toThrow(MergeError)
  })

  it('refuses an unknown token rather than leaving it in the email', () => {
    const content = { ...CONTENT, blocks: [{ type: 'text_block', data: { text: 'See you {{surname}}' } }] }
    expect(() => mergeCampaignContent(content as unknown as MarketingContent, FIELDS)).toThrow(MergeError)
  })

  it('lists the tokens content asks for', () => {
    expect(mergeTokensIn(CONTENT)).toEqual(['first_name', 'voucher_expires_on', 'voucher_number', 'voucher_percent'])
  })

  it('has sample values that fill every voucher token, for test sends', () => {
    expect(() => mergeCampaignContent(CONTENT, SAMPLE_MERGE_FIELDS)).not.toThrow()
  })
})

describe('booking links carry the party size', () => {
  it('adds party_size to the mapped booking link alongside the recipient, and nowhere else', () => {
    const html = `<a href="https://www.the-anchor.pub/book-table?source=return_visit_email">Book</a><a href="https://www.the-anchor.pub/whats-on">On</a>`
    const out = applyDeliveryTransforms(html, {
      unsubscribeUrl: 'https://example.test/u',
      linkMap: { 'https://www.the-anchor.pub/book-table?source=return_visit_email': 'https://l.the-anchor.pub/abc123' },
      recipientRef: 'rec-1',
      bookingPartySize: 4,
    })
    expect(out).toContain('href="https://l.the-anchor.pub/abc123?utm_content=rec-1&amp;party_size=4"')
    expect(out).not.toContain('whats-on?party_size')
  })

  it('still adds it when the short link could not be made', () => {
    const html = `<a href="https://www.the-anchor.pub/book-table">Book</a>`
    const out = applyDeliveryTransforms(html, { unsubscribeUrl: 'https://example.test/u', bookingPartySize: 2 })
    expect(out).toContain('book-table?party_size=2')
  })
})
