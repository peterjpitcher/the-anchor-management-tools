import { describe, expect, it } from 'vitest'

import { openingTimes } from '../blocks/opening_times'
import { marketingContentSchema, validateMarketingContent } from '../registry'
import { renderCampaignHtml, renderCampaignText, renderMarketingEmail } from '../render'

const content = marketingContentSchema.parse({
  title: 'Historical campaign',
  preheader: 'An email saved before the opening-times block was replaced.',
  blocks: [{ type: 'opening_times', data: openingTimes.sample }],
})

describe('saved opening_times campaigns', () => {
  it('validates and previews the original block without rewriting stored content', () => {
    const before = JSON.stringify(content)
    expect(validateMarketingContent(content)).toEqual([])
    expect(renderCampaignHtml(content)).toContain(openingTimes.render(openingTimes.sample))
    expect(renderCampaignText(content)).toContain('Kitchen closed')
    expect(renderCampaignText(content)).toContain('Lunch 12pm to 3pm, Dinner 4pm to 9pm')
    expect(JSON.stringify(content)).toBe(before)
  })

  it('renders both delivery alternatives without invalid placeholder values', () => {
    const rendered = renderMarketingEmail(content, { unsubscribeUrl: 'https://example.com/unsubscribe' })
    expect(rendered.html).toContain('Opening times')
    expect(rendered.text).toContain('OPENING TIMES')
    expect(rendered.html + rendered.text).not.toMatch(/undefined|Invalid Date|NaN/)
  })

  it('still rejects malformed historical data and genuinely unknown blocks', () => {
    const malformed = { ...content, blocks: [{ type: 'opening_times', data: { rows: [] } }] }
    expect(validateMarketingContent(malformed)).toHaveLength(1)
    expect(() => renderCampaignHtml(malformed)).toThrow()
    const unknown = { ...content, blocks: [{ type: 'missing_block', data: {} }] }
    expect(() => renderCampaignHtml(unknown)).toThrow('Unknown block type "missing_block"')
  })
})
