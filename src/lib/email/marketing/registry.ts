import { z } from 'zod'

import { amenityGrid } from './blocks/amenity_grid'
import { closingPanelDark } from './blocks/closing_panel_dark'
import { ctaOutline } from './blocks/cta_outline'
import { deadlineBar } from './blocks/deadline_bar'
import { dividerRule } from './blocks/divider_rule'
import { eventRow } from './blocks/event_row'
import { factStrip } from './blocks/fact_strip'
import { faqRows } from './blocks/faq_rows'
import { featureCard } from './blocks/feature_card'
import { footer } from './blocks/footer'
import { footerDark } from './blocks/footer_dark'
import { heroFramed } from './blocks/hero_framed'
import { heroImage } from './blocks/hero_image'
import { hoursTable } from './blocks/hours_table'
import { imageFull } from './blocks/image_full'
import { mastheadCream } from './blocks/masthead_cream'
import { mastheadGreen } from './blocks/masthead_green'
import { mediaRow } from './blocks/media_row'
import { menuList } from './blocks/menu_list'
import { noteBar } from './blocks/note_bar'
import { offerPanel } from './blocks/offer_panel'
import { priceTiles } from './blocks/price_tiles'
import { pullQuote } from './blocks/pull_quote'
import { reassuranceRow } from './blocks/reassurance_row'
import { review } from './blocks/review'
import { sectionIntro } from './blocks/section_intro'
import { signoffPs } from './blocks/signoff_ps'
import { steps } from './blocks/steps'
import { textBlock } from './blocks/text_block'
import { twoUpCards } from './blocks/two_up_cards'
import type { EmailBlockModule } from './blocks/types'
import { whatsOnList } from './blocks/whats_on_list'

/** Every block a campaign may use, keyed by the `type` stored in campaign content JSON. */
export const BLOCK_REGISTRY: Record<string, EmailBlockModule<any>> = {
  amenity_grid: amenityGrid,
  closing_panel_dark: closingPanelDark,
  cta_outline: ctaOutline,
  deadline_bar: deadlineBar,
  divider_rule: dividerRule,
  event_row: eventRow,
  fact_strip: factStrip,
  faq_rows: faqRows,
  feature_card: featureCard,
  footer: footer,
  footer_dark: footerDark,
  hero_framed: heroFramed,
  hero_image: heroImage,
  hours_table: hoursTable,
  image_full: imageFull,
  masthead_cream: mastheadCream,
  masthead_green: mastheadGreen,
  media_row: mediaRow,
  menu_list: menuList,
  note_bar: noteBar,
  offer_panel: offerPanel,
  price_tiles: priceTiles,
  pull_quote: pullQuote,
  reassurance_row: reassuranceRow,
  review: review,
  section_intro: sectionIntro,
  signoff_ps: signoffPs,
  steps: steps,
  text_block: textBlock,
  two_up_cards: twoUpCards,
  whats_on_list: whatsOnList,
}

export const BLOCK_TYPES = Object.keys(BLOCK_REGISTRY)

export const MASTHEAD_TYPES = ['masthead_green', 'masthead_cream']
export const FOOTER_TYPES = ['footer', 'footer_dark']

/**
 * Blocks taken from the library file carry their own 600px `<table>` wrapper, because that
 * file is a standalone preview where each block has to stand up on its own. The campaign
 * file instead puts every block inside ONE 600px table as `<tr>` rows, and the shell we use
 * comes from the campaign file, so rows are what a composed email needs.
 *
 * This is a genuine inconsistency between the two handover files rather than a decision.
 * The wrapper is stripped at compose time; `blocks.fidelity.test.ts` and
 * `campaign.fidelity.test.ts` prove both the block fixtures and the composed email stay
 * byte-exact, so the strip is lossless.
 */
export function needsPreviewWrapperStrip(block: EmailBlockModule<any>): boolean {
  return block.fixture.startsWith('lib_')
}

const PREVIEW_WRAPPER = /^<table role="presentation" width="600"[^>]*><tbody>\n?([\s\S]*?)\n?<\/tbody><\/table>\s*$/

/** Removes the standalone-preview table wrapper, leaving the `<tr>` rows. */
export function stripPreviewWrapper(html: string): string {
  const match = html.match(PREVIEW_WRAPPER)
  if (!match) {
    throw new Error('Expected a library block to be wrapped in a 600px preview table')
  }
  return match[1].endsWith('\n') ? match[1] : `${match[1]}\n`
}

/** One entry in a campaign's block list. */
export const blockEntrySchema = z.object({
  type: z.string().min(1),
  data: z.record(z.unknown()).default({}),
})

export type BlockEntry = z.infer<typeof blockEntrySchema>

/**
 * A whole campaign's content.
 *
 * Stored in `marketing_campaigns.content` and validated on every write and again before
 * every send, because a code deploy between those two moments can change what is valid.
 */
export const marketingContentSchema = z.object({
  schema_version: z.literal(1).default(1),
  title: z.string().min(1).max(200),
  preheader: z.string().min(1).max(300),
  blocks: z.array(blockEntrySchema).min(1).max(60),
})

export type MarketingContent = z.infer<typeof marketingContentSchema>

export interface ContentValidationIssue {
  index: number | null
  type: string | null
  message: string
}

/**
 * Validates the block list against the registry and each block's own schema.
 *
 * Returns issues rather than throwing so the UI can show every problem in a pasted content
 * file at once instead of one per attempt.
 */
export function validateMarketingContent(content: MarketingContent): ContentValidationIssue[] {
  const issues: ContentValidationIssue[] = []

  content.blocks.forEach((entry, index) => {
    const block = BLOCK_REGISTRY[entry.type]
    if (!block) {
      issues.push({ index, type: entry.type, message: `Unknown block type "${entry.type}"` })
      return
    }

    const parsed = block.schema.safeParse(entry.data)
    if (!parsed.success) {
      const first = parsed.error.errors[0]
      const path = first?.path?.length ? `${first.path.join('.')}: ` : ''
      issues.push({ index, type: entry.type, message: `${path}${first?.message ?? 'Invalid block data'}` })
    }
  })

  return issues
}

/** Non-fatal advice, surfaced in the UI and on a test send. */
export function lintMarketingContent(content: MarketingContent): string[] {
  const warnings: string[] = []
  const types = content.blocks.map((block) => block.type)

  if (!MASTHEAD_TYPES.includes(types[0] ?? '')) {
    warnings.push('The first block is usually a masthead.')
  }
  if (!FOOTER_TYPES.includes(types[types.length - 1] ?? '')) {
    warnings.push('The last block should be a footer, which is where the unsubscribe link lives.')
  }
  if (types.filter((type) => type === 'pull_quote').length > 1) {
    warnings.push('Use at most one pull quote per email.')
  }

  const primaryButtons = content.blocks.filter((block) =>
    ['hero_image', 'hero_framed', 'closing_panel_dark'].includes(block.type),
  ).length
  if (primaryButtons > 2) {
    warnings.push('More than two primary buttons competes for attention. One dominant action per email.')
  }

  const preheaderLength = content.preheader.length
  if (preheaderLength < 40 || preheaderLength > 120) {
    warnings.push(`The preheader is ${preheaderLength} characters. Aim for roughly 85.`)
  }

  return warnings
}
