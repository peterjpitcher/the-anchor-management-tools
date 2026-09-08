import { z } from 'zod'

import { escapeEmailText, escapeEmailUrl } from '../escape'
import { defineBlock, type EmailImage } from './types'

/**
 * Two 260px cards side by side, for a pair of things of equal weight.
 *
 * Exactly two cards: 260 plus 16 plus 260 fills the 536px column. Both card cells and the
 * gutter between them carry `class="stack"`, so on a phone the cards sit one above the
 * other with a 16px gap rather than touching.
 *
 * Redrawn in September 2026. The first version hardcoded `height="180"` on the card image,
 * so a square poster was declared 260 x 180 and drawn squashed by any client that trusts
 * the attributes. The caller now sets both: 258 wide, and the height from the artwork's own
 * ratio, which for the square posters this pub actually has is 258 x 258.
 *
 * Nothing here is a link. Use `grid_cards_linked` when the cards should be bookable.
 */

/** The image width the markup is drawn to. The card's max-width repeats it. */
const IMAGE_WIDTH = 258

/**
 * The designer's local placeholder, kept for a card with no photograph yet.
 *
 * Same contract as `image_full`: an empty `src` reproduces the handover byte for byte, a
 * real URL renders the photograph instead. The path is relative and cannot resolve in an
 * inbox, which is the point. It proves the fixture, it does not ship.
 */
const PLACEHOLDER_SRC = 'img/slot-1x1.png'

const SANS = "'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif"
const SERIF = "'DM Serif Display',Georgia,'Times New Roman',serif"

const cardImageSchema: z.ZodType<EmailImage> = z.object({
  /** Empty keeps the designer's placeholder. Otherwise an absolute https URL. */
  src: z.string(),
  alt: z.string().min(1).max(160),
  width: z.literal(IMAGE_WIDTH),
  height: z.number().int().positive(),
})

const cardSchema = z.object({
  image: cardImageSchema,
  heading: z.string().min(1).max(60),
  body: z.string().min(1).max(200),
})

export const twoUpCardsSchema = z.object({
  cards: z.array(cardSchema).length(2),
})

export type TwoUpCardsData = z.infer<typeof twoUpCardsSchema>

type TwoUpCard = z.infer<typeof cardSchema>

function cardCell(card: TwoUpCard): string[] {
  const src = card.image.src.trim() ? escapeEmailUrl(card.image.src) : PLACEHOLDER_SRC

  return [
    `<td width="260" valign="top" class="stack" style="width:260px"><table role="presentation" width="260" cellpadding="0" cellspacing="0" border="0" class="stack" style="width:100%;max-width:260px;border-collapse:collapse;background-color:#ffffff;border:1px solid #e2dccf"><tbody>`,
    `<tr><td style="padding:0;font-size:0;line-height:0"><img src="${src}" width="${card.image.width}" height="${card.image.height}" alt="${escapeEmailText(card.image.alt)}" style="display:block;width:100%;max-width:100%;height:auto;border:0"></td></tr>`,
    `<tr><td style="padding:18px 18px 0;font-family:${SERIF};font-size:21px;line-height:27px;color:#005131">${escapeEmailText(card.heading)}</td></tr>`,
    `<tr><td style="padding:8px 18px 20px;font-family:${SANS};font-size:14px;line-height:22px;color:#6f6a61">${escapeEmailText(card.body)}</td></tr>`,
    `</tbody></table></td>`,
  ]
}

/**
 * The 16px gap between the cards.
 *
 * It carries `class="stack"` too, so on a phone it stops being a column and becomes a 16px
 * vertical gap instead of collapsing and butting the two cards together.
 */
const GUTTER_CELL = `<td width="16" class="stack" style="width:16px;font-size:0;line-height:0;height:16px">&nbsp;</td>`

export const twoUpCards = defineBlock<TwoUpCardsData>({
  type: 'two_up_cards',
  fixture: 'lib_two_up_cards.html',
  schema: twoUpCardsSchema,
  sample: {
    cards: [
      {
        image: { src: '', alt: 'Quiz night', width: 258, height: 258 },
        heading: 'Quiz night',
        body: 'Two short lines of supporting copy sit here.',
      },
      {
        image: { src: '', alt: 'Beer garden', width: 258, height: 258 },
        heading: 'Beer garden',
        body: 'Two short lines of supporting copy sit here.',
      },
    ],
  },
  render: (data) => {
    const rows: string[] = [
      `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#faf8f3"><tbody>`,
      `<tr><td bgcolor="#faf8f3" class="gutter" style="background-color:#faf8f3;padding:32px;"><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse"><tbody>`,
      `<tr>`,
    ]

    data.cards.forEach((card, index) => {
      if (index > 0) rows.push(GUTTER_CELL)
      rows.push(...cardCell(card))
    })

    rows.push(`</tr>`)
    rows.push(`</tbody></table></td></tr>`)
    rows.push(`</tbody></table>`)

    return rows.join('\n')
  },
  text: (data) => {
    // Only describe a photograph when there is one to describe.
    const cards = data.cards.map((card) => {
      const image = card.image.src ? `[Image: ${card.image.alt}]\n` : ''
      return `${image}${card.heading}\n${card.body}`
    })

    return `${cards.join('\n\n')}\n`
  },
})
