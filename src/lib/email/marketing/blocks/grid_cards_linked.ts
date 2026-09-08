import { z } from 'zod'

import { escapeEmailText, escapeEmailUrl } from '../escape'
import { defineBlock, type EmailImage } from './types'

/**
 * Two or three cards side by side, each one bookable.
 *
 * `two_up_cards` is the same shape without a link, so it can show a thing but not sell it.
 * This one carries a call to action per card, and both the picture and the link go to the
 * same place, so a reader who taps a poster gets what they expected.
 *
 * The designer drew two variants and they are one block: the card count sets the geometry,
 * because 260 + 16 + 260 and 168 + 16 + 168 + 16 + 168 both fill the 536px column and
 * nothing else does. Everything that changes between them is in GEOMETRY below, so a card
 * cannot end up at a width the row cannot hold.
 *
 * Square posters fit best, 258 x 258 or 166 x 166. Anything else keeps its own ratio and
 * the row grows to the tallest card, which is why the artwork in one row should agree.
 */

interface Geometry {
  /** Outer cell and card table width. */
  cell: number
  /** Image width, two pixels inside the card so the card's border still reads. */
  image: number
  /** Horizontal padding inside the card, and the heading's top padding. */
  pad: number
  headingSize: number
  headingLine: number
  /** Bottom padding under the call to action. */
  ctaBottom: number
}

/** The only two layouts the 536px column can hold. Card count picks one. */
const GEOMETRY: Record<number, Geometry> = {
  2: { cell: 260, image: 258, pad: 16, headingSize: 21, headingLine: 27, ctaBottom: 20 },
  3: { cell: 168, image: 166, pad: 14, headingSize: 19, headingLine: 25, ctaBottom: 18 },
}

/**
 * The designer's local placeholder, kept for a card with no artwork yet.
 *
 * Same contract as `image_full` and `whats_on_media`: an empty `src` reproduces the
 * handover byte for byte, a real URL renders the photograph instead. The path is relative
 * and cannot resolve in an inbox, which is the point: it proves the fixture, it does not
 * ship.
 */
const PLACEHOLDER_SRC = 'img/slot-1x1.png'

const SANS = "'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif"
const SERIF = "'DM Serif Display',Georgia,'Times New Roman',serif"

const cardImageSchema: z.ZodType<EmailImage> = z.object({
  /** Empty keeps the designer's placeholder. Otherwise an absolute https URL. */
  src: z.string(),
  alt: z.string().min(1).max(160),
  /** 258 in a row of two, 166 in a row of three. Checked against the card count below. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

const linkedCardSchema = z.object({
  image: cardImageSchema,
  heading: z.string().min(1).max(60),
  /** Two lines. Longer and the shortest card in the row leaves a hole under it. */
  body: z.string().min(1).max(160),
  cta_label: z.string().min(1).max(40),
  url: z.string().min(1),
})

export type LinkedCardData = z.infer<typeof linkedCardSchema>

export const gridCardsLinkedSchema = z
  .object({
    cards: z.array(linkedCardSchema).min(2).max(3),
  })
  .superRefine((data, ctx) => {
    // zod runs a refinement even when an earlier rule has already failed, so a row of one
    // or four arrives here with no geometry to look up. Report the count and stop rather
    // than throwing: `validateMarketingContent` is meant to hand the UI every problem in a
    // pasted file at once, and an exception here would take the whole page down instead.
    const geometry = GEOMETRY[data.cards.length]
    if (!geometry) return

    // The image width is written into the markup twice, as an attribute and as max-width.
    // A card whose artwork disagrees renders at one size and reserves space for another,
    // which is the exact fault this block was drawn to fix.
    const expected = geometry.image

    data.cards.forEach((card, index) => {
      if (card.image.width !== expected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cards', index, 'image', 'width'],
          message: `A row of ${data.cards.length} needs images ${expected} wide, not ${card.image.width}`,
        })
      }
    })
  })

export type GridCardsLinkedData = z.infer<typeof gridCardsLinkedSchema>

function cardCell(card: LinkedCardData, geometry: Geometry): string {
  const href = escapeEmailUrl(card.url)
  const src = card.image.src.trim() ? escapeEmailUrl(card.image.src) : PLACEHOLDER_SRC

  return [
    `<td width="${geometry.cell}" valign="top" class="stack" style="width:${geometry.cell}px"><table role="presentation" width="${geometry.cell}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${geometry.cell}px;border-collapse:collapse;background-color:#ffffff;border:1px solid #e2dccf"><tbody>`,
    `<tr><td style="padding:0;font-size:0;line-height:0"><a href="${href}" style="text-decoration:none"><img src="${src}" width="${card.image.width}" height="${card.image.height}" alt="${escapeEmailText(card.image.alt)}" style="display:block;width:100%;max-width:${geometry.image}px;height:auto;border:0"></a></td></tr>`,
    `<tr><td style="padding:${geometry.pad}px ${geometry.pad}px 0;font-family:${SERIF};font-size:${geometry.headingSize}px;line-height:${geometry.headingLine}px;color:#005131">${escapeEmailText(card.heading)}</td></tr>`,
    `<tr><td style="padding:6px ${geometry.pad}px 0;font-family:${SANS};font-size:13px;line-height:20px;color:#6f6a61">${escapeEmailText(card.body)}</td></tr>`,
    `<tr><td style="padding:12px ${geometry.pad}px ${geometry.ctaBottom}px;font-family:${SANS};font-size:14px;font-weight:600;line-height:20px"><a href="${href}" style="color:#8b6914;text-decoration:none">${escapeEmailText(card.cta_label)}</a></td></tr>`,
    `</tbody></table></td>`,
  ].join('\n')
}

/**
 * The 16px gap between cards.
 *
 * It carries `class="stack"` as well, so on a phone it stops being a column and becomes a
 * 16px vertical gap instead of vanishing and butting two cards together.
 */
const GUTTER_CELL = `<td width="16" class="stack" style="width:16px;font-size:0;line-height:0;height:16px">&nbsp;</td>`

/** The three-across variant, kept here so its fidelity test uses the designer's own values. */
export const gridCardsLinkedThreeSample: GridCardsLinkedData = {
  cards: [
    {
      image: { src: '', alt: 'Quiz night poster', width: 166, height: 166 },
      heading: 'Quiz night',
      body: 'Wed 2 Dec, 7pm. Teams of up to six.',
      cta_label: 'Book →',
      url: 'https://www.the-anchor.pub/whats-on',
    },
    {
      image: { src: '', alt: 'Drag cabaret poster', width: 166, height: 166 },
      heading: 'Drag cabaret',
      body: 'Fri 4 Dec, doors 7pm. Free entry.',
      cta_label: 'Reserve →',
      url: 'https://www.the-anchor.pub/whats-on',
    },
    {
      image: { src: '', alt: 'Sunday roast', width: 166, height: 166 },
      heading: 'Sunday roast',
      body: 'Sun 6 Dec, 12pm to 5pm. Carved to order.',
      cta_label: 'Book →',
      url: 'https://www.the-anchor.pub/sunday-roast',
    },
  ],
}

export const gridCardsLinked = defineBlock<GridCardsLinkedData>({
  type: 'grid_cards_linked',
  fixture: 'lib_grid_cards_linked.html',
  schema: gridCardsLinkedSchema,
  sample: {
    cards: [
      {
        image: { src: '', alt: 'Drag cabaret poster', width: 258, height: 258 },
        heading: 'Drag cabaret',
        body: 'Fri 4 Dec, doors 7pm. Nikki Manfadge, free entry, book to be sure of a seat.',
        cta_label: 'Reserve a table →',
        url: 'https://www.the-anchor.pub/whats-on',
      },
      {
        image: { src: '', alt: 'Sunday roast', width: 258, height: 258 },
        heading: 'Sunday roast',
        body: 'Sun 6 Dec, 12pm to 5pm. Carved fresh to order, no pre-order needed.',
        cta_label: 'Book a table →',
        url: 'https://www.the-anchor.pub/sunday-roast',
      },
    ],
  },
  render: (data) => {
    const geometry = GEOMETRY[data.cards.length]
    const cells: string[] = []

    data.cards.forEach((card, index) => {
      if (index > 0) cells.push(GUTTER_CELL)
      cells.push(cardCell(card, geometry))
    })

    return [
      `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#faf8f3"><tbody>`,
      `<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:32px;"><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse"><tbody>`,
      `<tr>`,
      ...cells,
      `</tr>`,
      `</tbody></table></td></tr>`,
      `</tbody></table>`,
    ].join('\n')
  },
  text: (data) => {
    const cards = data.cards.map(
      (card) => `${card.heading}\n${card.body}\n${card.cta_label.replace(/\s*→$/, '')}: ${card.url}`,
    )

    return `${cards.join('\n\n')}\n`
  },
})
