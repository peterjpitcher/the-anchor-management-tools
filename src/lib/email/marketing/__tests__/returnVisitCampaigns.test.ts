import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { houseStyleErrors } from '@/lib/copy/house-style'
import { lifecycleContentProblems } from '../lifecycle'
import { mergeCampaignContent } from '../merge'
import { marketingContentSchema, validateMarketingContent } from '../registry'
import { applyDeliveryTransforms, renderCampaignText, renderMarketingEmail } from '../render'
import { findVenueClosureClaims } from '../venueClosureClaims'
import type { ReturnVisitFilter } from '@/types/marketing'

// The two return-visit emails as the owner will approve them, rendered with the values a real
// guest's row carries. Fails on anything that has reached a customer before: a raw token, an
// "undefined", an Invalid Date, a missing voucher number or a missing booking link.

const FILES = {
  touch1: 'return-visit-touch-1-10.json',
  touch2: 'return-visit-touch-2-25.json',
} as const

function load(file: string) {
  const raw = JSON.parse(readFileSync(path.join(__dirname, '..', 'campaigns', file), 'utf8'))
  return marketingContentSchema.parse(raw)
}

const FILTER: ReturnVisitFilter = {
  rule: 'table_return_visit',
  touch: 1,
  days_since_anchor_min: 45,
  days_since_anchor_max: 180,
  voucher_type_id: 'return-10',
}

describe.each([
  ['touch 1', FILES.touch1, 10],
  ['touch 2', FILES.touch2, 25],
])('%s return-visit email', (_label, file, percent) => {
  const content = load(file)
  const fields = {
    first_name: 'Sam',
    party_size: 4,
    voucher_number: 'AN-2612-0103',
    voucher_percent: percent,
    voucher_expires_on: '2027-01-14',
  }

  it('is valid content that a return-visit campaign accepts', () => {
    expect(validateMarketingContent(content)).toEqual([])
    expect(lifecycleContentProblems(content, FILTER)).toEqual([])
  })

  it('renders clean, with the voucher, its conditions and the booking link', () => {
    const merged = mergeCampaignContent(content, fields)
    const { html, text } = renderMarketingEmail(merged, { unsubscribeUrl: 'https://example.test/u' })

    for (const output of [html, text]) {
      expect(output).not.toMatch(/\{\{|\}\}|undefined|Invalid Date|NaN/)
      expect(output).toContain('AN-2612-0103')
      expect(output).toContain('Thursday 14 January 2027')
      expect(output).toContain(`${percent}% off your food`)
      expect(output).toContain('Drinks are not included.')
      expect(output).toContain('book-table?source=return_visit_email')
    }
    expect(html).toContain('Hi Sam,')
    expect(html).toContain('For Sam&rsquo;s table')
  })

  it('greets a guest with no usable name without a gap', () => {
    const merged = mergeCampaignContent(content, { ...fields, first_name: 'Guest' })
    const { html } = renderMarketingEmail(merged, { unsubscribeUrl: 'https://example.test/u' })
    expect(html).toContain('Hi there,')
    expect(html).not.toMatch(/Hi ,|For &rsquo;s/)
  })

  it('puts the party size on the booking link', () => {
    const merged = mergeCampaignContent(content, fields)
    const { html } = renderMarketingEmail(merged, { unsubscribeUrl: 'https://example.test/u' })
    const delivered = applyDeliveryTransforms(html, {
      unsubscribeUrl: 'https://example.test/u',
      recipientRef: 'rec-1',
      bookingPartySize: 4,
    })
    expect(delivered).toContain('party_size=4')
  })

  it('carries no banned claim, price, or closure promise, and no em dash', () => {
    const text = renderCampaignText(mergeCampaignContent(content, fields))
    expect(houseStyleErrors(text)).toEqual([])
    expect(text).not.toMatch(/£\s?\d/)
    expect(text).not.toMatch(/\b(today|tonight)\b/i)
    expect(text).not.toContain(String.fromCharCode(0x2014))
    expect(findVenueClosureClaims(text)).toEqual([])
  })
})
