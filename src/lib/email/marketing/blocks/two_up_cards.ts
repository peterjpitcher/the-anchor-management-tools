import { z } from 'zod'

import { escapeEmailText, escapeEmailUrl } from '../escape'
import { defineBlock, type EmailImage } from './types'

/**
 * Two 260px cards side by side, for a pair of things of equal weight.
 *
 * Exactly two cards: 260 plus 16 plus 260 fills the 536px column, and both cells carry
 * `class="stack"` so they sit one above the other on a phone.
 *
 * The designer's handover ships the cards with a tinted image placeholder rather than a
 * photograph, so an empty `src` keeps that placeholder and a real `src` renders the
 * photograph in its place. Always write the alt text either way: about a third of opens
 * have images off.
 */

const cardImageSchema: z.ZodType<EmailImage> = z.object({
  /** Empty keeps the designer's placeholder. Otherwise an absolute https URL. */
  src: z.string(),
  alt: z.string().min(1).max(160),
  width: z.number().int().positive(),
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

function cardImageRow(image: EmailImage): string {
  if (image.src) {
    return `<tr><td style="padding:0;font-size:0;line-height:0"><img src="${escapeEmailUrl(image.src)}" width="260" height="180" alt="${escapeEmailText(image.alt)}" style="display:block;width:100%;max-width:260px;height:auto;border:0"></td></tr>`
  }

  return `<tr><td align="center" valign="middle" height="180" style="height:180px;background-color:#f5e6d3;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;line-height:18px;letter-spacing:0.12em;text-transform:uppercase;color:#8b6914">Image &middot; ${image.width} &times; ${image.height}</td></tr>`
}

function cardCell(card: TwoUpCard): string[] {
  return [
    `<td width="260" valign="top" class="stack" style="width:260px"><table role="presentation" width="260" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:260px;border-collapse:collapse;background-color:#ffffff;border:1px solid #e2dccf"><tbody>`,
    cardImageRow(card.image),
    `<tr><td style="padding:18px 18px 0;font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:21px;line-height:27px;color:#005131">${escapeEmailText(card.heading)}</td></tr>`,
    `<tr><td style="padding:8px 18px 20px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:#6f6a61">${escapeEmailText(card.body)}</td></tr>`,
    `</tbody></table></td>`,
  ]
}

export const twoUpCards = defineBlock<TwoUpCardsData>({
  type: 'two_up_cards',
  fixture: 'lib_two_up_cards.html',
  schema: twoUpCardsSchema,
  sample: {
    cards: [
      {
        image: {
          src: '',
          alt: 'A full table of quizzers on a Wednesday night',
          width: 520,
          height: 360,
        },
        heading: 'Quiz night',
        body: 'Two short lines of supporting copy sit here.',
      },
      {
        image: {
          src: '',
          alt: 'The beer garden on a sunny afternoon',
          width: 520,
          height: 360,
        },
        heading: 'Beer garden',
        body: 'Two short lines of supporting copy sit here.',
      },
    ],
  },
  render: (data) => {
    const rows: string[] = [
      `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#faf8f3"><tbody>`,
      `<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:32px"><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse"><tbody><tr>`,
    ]

    data.cards.forEach((card, index) => {
      if (index > 0) {
        rows.push(`<td width="16" style="width:16px;font-size:0;line-height:0">&nbsp;</td>`)
      }
      rows.push(...cardCell(card))
    })

    rows.push(`</tr></tbody></table></td></tr>`)
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
