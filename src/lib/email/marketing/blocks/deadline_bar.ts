import { z } from 'zod'

import { escapeEmailText, escapeEmailUrl } from '../escape'
import { defineBlock } from './types'

/**
 * Solid gold strip for a real constraint: a genuine date or a genuine capacity limit.
 *
 * Not a countdown widget. The brand's first rule is honesty, so if the deadline is not
 * real this block does not go in the email.
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
    `<tr><td bgcolor="#a57626" align="center" style="background-color:#a57626;padding:15px 32px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;line-height:22px;color:#1a1a1a">${escapeEmailText(data.text)} <a href="${escapeEmailUrl(data.link_url)}" style="color:#1a1a1a;text-decoration:underline">${escapeEmailText(data.link_label)}</a></td></tr>
`,
  text: (data) => `${data.text} ${data.link_label}: ${data.link_url}\n`,
})
