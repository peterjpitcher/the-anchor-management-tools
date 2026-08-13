import { z } from 'zod'

import { escapeEmailText } from '../escape'
import { defineBlock } from './types'

/**
 * A guest review: a row of stars, the quote, and who said it.
 *
 * BRAND RULE, from the handover and not negotiable: the quote must be a real review,
 * pasted verbatim from Google or Facebook. Never write one, never tidy one up, never
 * compose a plausible-sounding quote to fill the slot. If there is no real review to hand,
 * the block does not go in the email. The star count must match the review it came from.
 *
 * The typographic quote marks are part of the block, so `quote` holds the words alone. The
 * star is the one Unicode character the brand permits, and it goes through the escaper so
 * it lands as the numeric entity older clients cope with.
 */

/** Filled star, U+2605. Written by code point so this file stays pure ASCII. */
const FILLED_STAR = String.fromCodePoint(0x2605)

export const reviewSchema = z.object({
  /** How many stars the real review gave, 1 to 5. */
  stars: z.number().int().min(1).max(5),
  /** The review, word for word. Never written, never edited. */
  quote: z.string().min(1).max(320),
  /** Who left it and where, e.g. "Reviewer name (middot) Google review". */
  attribution: z.string().min(1).max(120),
})

export type ReviewData = z.infer<typeof reviewSchema>

export const review = defineBlock<ReviewData>({
  type: 'review',
  fixture: 'lib_review.html',
  schema: reviewSchema,
  sample: {
    stars: 5,
    quote: 'Paste a real guest review here, word for word, from Google or Facebook.',
    attribution: 'Reviewer name · Google review',
  },
  render: (data) =>
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#faf8f3"><tbody>
<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:32px"><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse;background-color:#ffffff;border:1px solid #e2dccf"><tbody>
<tr><td align="center" style="padding:26px 30px 0;font-family:'Outfit',Helvetica,Arial,sans-serif;font-size:18px;line-height:24px;letter-spacing:0.2em;color:#a57626">${escapeEmailText(FILLED_STAR.repeat(data.stars))}</td></tr>
<tr><td align="center" style="padding:12px 34px 0;font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:21px;line-height:29px;letter-spacing:-0.01em;color:#1a1a1a">&ldquo;${escapeEmailText(data.quote)}&rdquo;</td></tr>
<tr><td align="center" style="padding:12px 30px 26px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;line-height:20px;letter-spacing:0.06em;text-transform:uppercase;color:#6f6a61">${escapeEmailText(data.attribution)}</td></tr>
</tbody></table></td></tr>
</tbody></table>`,
  text: (data) =>
    `${FILLED_STAR.repeat(data.stars)}\n"${data.quote}"\n${data.attribution}\n`,
})
