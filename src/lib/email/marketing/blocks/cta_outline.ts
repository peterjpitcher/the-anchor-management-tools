import { z } from 'zod'

import { escapeEmailText, escapeEmailUrl } from '../escape'
import { defineBlock } from './types'

/**
 * The outline button: transparent fill, 2px solid green border, green label.
 *
 * The middle rung of the emphasis ladder. One primary action per email, so this is what a
 * secondary action uses, for example "see the food menu" under a booking button. It is the
 * bulletproof pattern throughout: a padded cell carrying the border and radius, with the
 * link filling it, never an image and never a real button element.
 */

export const ctaOutlineSchema = z.object({
  label: z.string().min(1).max(60),
  url: z.string().min(1).max(2048),
})

export type CtaOutlineData = z.infer<typeof ctaOutlineSchema>

export const ctaOutline = defineBlock<CtaOutlineData>({
  type: 'cta_outline',
  fixture: 'cta_outline.html',
  schema: ctaOutlineSchema,
  sample: {
    label: 'See the food menu',
    url: 'https://www.the-anchor.pub/food-menu',
  },
  render: (data) =>
    `
<tr><td bgcolor="#faf8f3" align="left" style="background-color:#faf8f3;padding:24px 32px 36px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tbody><tr><td align="center" style="border:2px solid #005131;border-radius:999px"><a href="${escapeEmailUrl(data.url)}" style="display:block;padding:13px 30px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;line-height:20px;color:#005131;text-decoration:none">${escapeEmailText(data.label)}</a></td></tr></tbody></table>
</td></tr>
`,
  text: (data) => `${data.label}: ${data.url}\n`,
})
