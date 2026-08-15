import { z } from 'zod'

import { escapeEmailText, escapeEmailUrl } from '../escape'
import { defineBlock } from './types'

/**
 * A single event, with the green date badge on the left and a link out on the right.
 *
 * For one event that the email is actually about. Several events belong in
 * `whats_on_list`, which stacks a lighter version of this row.
 *
 * `date` is a string rather than a number so a campaign can carry the day exactly as it
 * should read, and `day` and `month` are the short forms the badge is sized for (Fri, Nov).
 */

export const eventRowSchema = z.object({
  /** Short weekday for the top of the badge, e.g. Fri. */
  day: z.string().min(1).max(12),
  /** Day of the month, e.g. 14. */
  date: z.string().min(1).max(4),
  /** Short month for the foot of the badge, e.g. Nov. */
  month: z.string().min(1).max(12),
  title: z.string().min(1).max(120),
  detail: z.string().min(1).max(160),
  url: z.string().min(1),
})

export type EventRowData = z.infer<typeof eventRowSchema>

export const eventRow = defineBlock<EventRowData>({
  type: 'event_row',
  fixture: 'lib_event_row.html',
  schema: eventRowSchema,
  sample: {
    day: 'Fri',
    date: '14',
    month: 'Nov',
    title: 'Christmas quiz night',
    detail: '7pm start · teams of up to six',
    url: 'https://www.the-anchor.pub/whats-on',
  },
  render: (data) =>
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#faf8f3"><tbody>
<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:32px"><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse;background-color:#ffffff;border:1px solid #e2dccf"><tbody>
<tr>
<td width="86" align="center" valign="middle" bgcolor="#005131" style="width:86px;background-color:#005131;padding:16px 0"><div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;line-height:16px;letter-spacing:0.16em;text-transform:uppercase;color:#c9a020">${escapeEmailText(data.day)}</div><div style="font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:30px;line-height:34px;color:#ffffff">${escapeEmailText(data.date)}</div><div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;line-height:16px;letter-spacing:0.16em;text-transform:uppercase;color:#c9a020">${escapeEmailText(data.month)}</div></td>
<td valign="middle" style="padding:16px 20px"><div style="font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:22px;line-height:28px;color:#005131">${escapeEmailText(data.title)}</div><div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:#6f6a61;padding-top:2px">${escapeEmailText(data.detail)}</div></td>
<td width="112" valign="middle" align="right" style="width:112px;padding:16px 20px 16px 0;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;line-height:22px"><a href="${escapeEmailUrl(data.url)}" style="color:#8b6914;text-decoration:none">Book now &rarr;</a></td>
</tr>
</tbody></table></td></tr>
</tbody></table>`,
  text: (data) =>
    `${data.day} ${data.date} ${data.month}: ${data.title}\n${data.detail}\nDetails: ${data.url}\n`,
})
