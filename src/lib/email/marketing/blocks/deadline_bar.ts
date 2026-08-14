import { z } from 'zod'

import { escapeEmailText, escapeEmailUrl } from '../escape'
import { defineBlock } from './types'

/**
 * Solid gold strip for a real constraint: a genuine date or a genuine capacity limit.
 *
 * Not a countdown widget. The brand's first rule is honesty, so if the deadline is not
 * real this block does not go in the email.
 *
 * Colour deviation from the handover. The owner asked for white text on every gold fill.
 * White on the designer's #a57626 measures 4.02:1, which only clears AA for large text, so
 * the fill darkens to the palette's #8b6914 where white reaches 5.09:1 and passes AA at this
 * 14px size. The link keeps its underline, because on a solid fill the underline is the only
 * thing left distinguishing it from the sentence around it.
 */

export const deadlineBarSchema = z.object({
  text: z.string().min(1).max(160),
  link_label: z.string().min(1).max(80),
  link_url: z.string().min(1),
})

export type DeadlineBarData = z.infer<typeof deadlineBarSchema>

export const deadlineBar = defineBlock<DeadlineBarData>({
  type: 'deadline_bar',
  fixture: 'deadline_bar_campaign.html',
  schema: deadlineBarSchema,
  sample: {
    text: 'December Fridays and Saturdays go first.',
    link_label: 'Lock in your date today',
    link_url: 'https://www.the-anchor.pub/christmas-parties',
  },
  render: (data) =>
    `<tr><td bgcolor="#8b6914" align="center" style="background-color:#8b6914;padding:15px 32px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;line-height:22px;color:#ffffff">${escapeEmailText(data.text)} <a href="${escapeEmailUrl(data.link_url)}" style="color:#ffffff;text-decoration:underline">${escapeEmailText(data.link_label)}</a></td></tr>
`,
  text: (data) => `${data.text} ${data.link_label}: ${data.link_url}\n`,
})
