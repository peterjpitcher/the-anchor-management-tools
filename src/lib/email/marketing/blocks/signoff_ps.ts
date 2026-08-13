import { z } from 'zod'

import { escapeEmailText, escapeEmailUrl } from '../escape'
import { defineBlock } from './types'

/**
 * Sign-off with a script signature, then a P.S.
 *
 * The P.S. is one of the most-read lines in any email, so it carries the deadline or the
 * single strongest reason to act, and exactly one link. Do not spend it on pleasantries.
 */

export const signoffPsSchema = z.object({
  signoff: z.string().min(1).max(120),
  signature: z.string().min(1).max(120),
  ps_body: z.string().min(1).max(400),
  ps_link_label: z.string().min(1).max(80),
  ps_link_url: z.string().min(1),
})

export type SignoffPsData = z.infer<typeof signoffPsSchema>

export const signoffPs = defineBlock<SignoffPsData>({
  type: 'signoff_ps',
  fixture: 'signoff_ps_campaign.html',
  schema: signoffPsSchema,
  sample: {
    signoff: 'See you at the bar,',
    signature: 'The Anchor team',
    ps_body:
      'Pre-orders are due 7 days before your date, so the earlier it is locked in, the easier it is on everyone.',
    ps_link_label: 'Lock in your date →',
    ps_link_url: 'https://www.the-anchor.pub/christmas-parties',
  },
  render: (data) =>
    `
<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:30px 32px 0;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:27px;color:#1a1a1a">${escapeEmailText(data.signoff)}</td></tr>
<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:2px 32px 0;font-family:'Clicker Script','Segoe Script','Brush Script MT',cursive;font-size:34px;line-height:42px;color:#005131">${escapeEmailText(data.signature)}</td></tr>
<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:18px 32px 32px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:25px;color:#1a1a1a"><strong style="color:#005131">P.S.</strong> ${escapeEmailText(data.ps_body)} <a href="${escapeEmailUrl(data.ps_link_url)}" style="color:#8b6914;font-weight:600;text-decoration:none">${escapeEmailText(data.ps_link_label)}</a></td></tr>
`,
  text: (data) =>
    `\n${data.signoff}\n${data.signature}\n\nP.S. ${data.ps_body} ${data.ps_link_label}: ${data.ps_link_url}\n`,
})
