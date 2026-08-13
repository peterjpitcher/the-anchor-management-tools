import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  lintMarketingContent,
  marketingContentSchema,
  validateMarketingContent,
  type MarketingContent,
} from '../registry'

/**
 * Campaign content is pasted in by a person and rendered by a machine weeks later, so the
 * gap between "saved" and "sent" is where the damage happens. Validation runs on write and
 * again immediately before the send, because a deploy in between can change what is valid.
 *
 * Validation returns issues rather than throwing so the editor can see every problem in a
 * pasted file at once, instead of fixing them one failed save at a time. The linter is
 * separate and advisory: it catches the things that are legal but wrong, the worst of which
 * is an email with no footer and therefore no unsubscribe link.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CAMPAIGN_JSON = path.join(HERE, '..', 'campaigns', 'christmas-and-lunch-2026.json')

const christmasCampaign = marketingContentSchema.parse(
  JSON.parse(readFileSync(CAMPAIGN_JSON, 'utf8')),
)

/** A schema-valid, lint-clean skeleton to vary one thing at a time from. */
function content(
  blocks: Array<{ type: string; data?: Record<string, unknown> }>,
  overrides: Partial<MarketingContent> = {},
): MarketingContent {
  return {
    schema_version: 1,
    title: 'A test campaign',
    preheader: 'Roughly the length a real preheader runs to, so the linter has nothing to say.',
    blocks: blocks.map((block) => ({ type: block.type, data: block.data ?? {} })),
    ...overrides,
  }
}

const VALID_FOOTER = {
  type: 'footer',
  data: {
    unsubscribe_url: '%%unsubscribe%%',
    reason_for_contact: 'You are receiving this because we contacted you in your business capacity.',
    year: '2026',
  },
}

describe('marketingContentSchema', () => {
  it('rejects a campaign with no blocks, which would send an empty document', () => {
    const result = marketingContentSchema.safeParse({
      title: 'Nothing to say',
      preheader: 'An empty campaign should never reach a recipient.',
      blocks: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a missing preheader, because the inbox then previews the raw markup instead', () => {
    const result = marketingContentSchema.safeParse({
      title: 'No preheader',
      blocks: [VALID_FOOTER],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a preheader over 300 characters, which no client will show', () => {
    const result = marketingContentSchema.safeParse({
      title: 'Far too much preview text',
      preheader: 'x'.repeat(301),
      blocks: [VALID_FOOTER],
    })
    expect(result.success).toBe(false)
  })

  it('accepts the shipped Christmas campaign, which is the shape everything else is judged by', () => {
    expect(marketingContentSchema.safeParse(JSON.parse(readFileSync(CAMPAIGN_JSON, 'utf8'))).success).toBe(
      true,
    )
  })
})

describe('validateMarketingContent', () => {
  it('names an unknown block type and where it sits, so the editor can find it in a long file', () => {
    // Without the index, "unknown block type" in a 40 block campaign is a hunt.
    const issues = validateMarketingContent(
      content([{ type: 'masthead_green' }, { type: 'carousel' }, VALID_FOOTER]),
    )
    expect(issues).toEqual([
      { index: 1, type: 'carousel', message: 'Unknown block type "carousel"' },
    ])
  })

  it('names the field when a block\'s own data is wrong, not just the block', () => {
    // A heading that is present but empty is the sort of thing a paste loses. Saying
    // "text_block is invalid" sends the editor looking through every field it has.
    const issues = validateMarketingContent(
      content([
        { type: 'masthead_green' },
        { type: 'text_block', data: { body: ['Copy with no heading above it.'] } },
        VALID_FOOTER,
      ]),
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]?.index).toBe(1)
    expect(issues[0]?.type).toBe('text_block')
    expect(issues[0]?.message).toMatch(/^heading: /)
  })

  it('reports every bad block at once, rather than one failed save at a time', () => {
    const issues = validateMarketingContent(
      content([{ type: 'carousel' }, { type: 'countdown' }, VALID_FOOTER]),
    )
    expect(issues.map((issue) => issue.index)).toEqual([0, 1])
  })

  it('returns nothing at all for the shipped Christmas campaign', () => {
    expect(validateMarketingContent(christmasCampaign)).toEqual([])
  })
})

describe('lintMarketingContent', () => {
  it('warns when the last block is not a footer, which is where the unsubscribe link lives', () => {
    // The single worst legal-but-wrong campaign: renders perfectly, opts nobody out.
    const warnings = lintMarketingContent(
      content([{ type: 'masthead_green' }, { type: 'divider_rule' }]),
    )
    expect(warnings).toContain(
      'The last block should be a footer, which is where the unsubscribe link lives.',
    )
  })

  it('warns about a second pull quote, since two competing pull quotes read as neither', () => {
    const pullQuote = {
      type: 'pull_quote',
      data: { quote: 'A line worth pulling out.', attribution: 'A guest' },
    }
    const warnings = lintMarketingContent(
      content([{ type: 'masthead_green' }, pullQuote, pullQuote, VALID_FOOTER]),
    )
    expect(warnings).toContain('Use at most one pull quote per email.')
  })

  it('warns when the preheader is far off 85 characters, because the inbox truncates it', () => {
    const warnings = lintMarketingContent(
      content([{ type: 'masthead_green' }, VALID_FOOTER], { preheader: 'Book now.' }),
    )
    expect(warnings).toContain('The preheader is 9 characters. Aim for roughly 85.')
  })

  it('warns when a long preheader will be cut off mid sentence', () => {
    const preheader = 'x'.repeat(200)
    const warnings = lintMarketingContent(
      content([{ type: 'masthead_green' }, VALID_FOOTER], { preheader }),
    )
    expect(warnings).toContain('The preheader is 200 characters. Aim for roughly 85.')
  })

  it('warns when the first block is not a masthead, since the brand should open the email', () => {
    const warnings = lintMarketingContent(content([{ type: 'divider_rule' }, VALID_FOOTER]))
    expect(warnings).toContain('The first block is usually a masthead.')
  })

  it('says nothing about the shipped Christmas campaign, which must be lint-clean', () => {
    // The campaign we actually send is the worked example. If it trips its own linter, either
    // the campaign or the advice is wrong, and staff learn to ignore the warnings either way.
    expect(lintMarketingContent(christmasCampaign)).toEqual([])
  })
})
