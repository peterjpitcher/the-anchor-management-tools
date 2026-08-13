import { z } from 'zod'

import { escapeEmailText, escapeEmailUrl } from '../escape'
import { defineBlock } from './types'

/**
 * Several events stacked in one panel, under a kicker and a heading, with a link to the
 * full listing underneath.
 *
 * The monthly what's on round-up. One event on its own is `event_row` instead.
 *
 * The nested rows are not the `event_row` block: the designer draws a lighter badge here,
 * showing only the date and the month, so this module transcribes what this fixture
 * contains rather than importing the other one. An `event_row` payload still validates,
 * because zod strips the keys this markup has no place for. The hairline sits on every row
 * except the last, which is why the row markup varies by position.
 */

const whatsOnEventSchema = z.object({
  /** Day of the month, e.g. 14. */
  date: z.string().min(1).max(4),
  /** Short month, e.g. Nov. */
  month: z.string().min(1).max(12),
  title: z.string().min(1).max(120),
  detail: z.string().min(1).max(160),
  url: z.string().min(1),
})

export type WhatsOnEventData = z.infer<typeof whatsOnEventSchema>

export const whatsOnListSchema = z.object({
  kicker: z.string().min(1).max(60),
  heading: z.string().min(1).max(120),
  events: z.array(whatsOnEventSchema).min(1).max(8),
  all_events_url: z.string().min(1),
})

export type WhatsOnListData = z.infer<typeof whatsOnListSchema>

function eventRowMarkup(event: WhatsOnEventData, isLast: boolean): string {
  const hairline = isLast ? '' : ';border-bottom:1px solid #efe9dd'

  return `<tr><td width="76" align="center" valign="middle" style="width:76px;padding:14px 0${hairline}"><div style="font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:24px;line-height:28px;color:#005131">${escapeEmailText(event.date)}</div><div style="font-family:'Outfit',Helvetica,Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#8b6914">${escapeEmailText(event.month)}</div></td><td valign="middle" style="padding:14px 16px${hairline}"><div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;line-height:23px;color:#1a1a1a">${escapeEmailText(event.title)}</div><div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#6f6a61">${escapeEmailText(event.detail)}</div></td><td width="90" valign="middle" align="right" style="width:90px;padding:14px 18px 14px 0${hairline};font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;line-height:20px"><a href="${escapeEmailUrl(event.url)}" style="color:#8b6914;text-decoration:none">Details &rarr;</a></td></tr>`
}

export const whatsOnList = defineBlock<WhatsOnListData>({
  type: 'whats_on_list',
  fixture: 'lib_whats_on_list.html',
  schema: whatsOnListSchema,
  sample: {
    kicker: 'What’s on',
    heading: 'Coming up at the pub',
    events: [
      {
        date: '14',
        month: 'Nov',
        title: 'Event name here',
        detail: 'One line of detail, time and price',
        url: 'https://www.the-anchor.pub/whats-on',
      },
      {
        date: '21',
        month: 'Nov',
        title: 'Event name here',
        detail: 'One line of detail, time and price',
        url: 'https://www.the-anchor.pub/whats-on',
      },
    ],
    all_events_url: 'https://www.the-anchor.pub/whats-on',
  },
  render: (data) =>
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#faf8f3"><tbody>
<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:32px 32px 4px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;line-height:16px;letter-spacing:0.18em;text-transform:uppercase;color:#8b6914">${escapeEmailText(data.kicker)}</td></tr>
<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:8px 32px 14px;font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:26px;line-height:32px;letter-spacing:-0.02em;color:#005131">${escapeEmailText(data.heading)}</td></tr>
<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:0 32px"><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse;background-color:#ffffff;border:1px solid #e2dccf"><tbody>
${data.events
  .map((event, index) => eventRowMarkup(event, index === data.events.length - 1))
  .join('\n')}
</tbody></table></td></tr>
<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:14px 32px 30px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;line-height:20px"><a href="${escapeEmailUrl(data.all_events_url)}" style="color:#8b6914;text-decoration:none">See everything on this month &rarr;</a></td></tr>
</tbody></table>`,
  text: (data) => {
    const events = data.events
      .map((event) => `${event.date} ${event.month}: ${event.title}. ${event.detail}. ${event.url}`)
      .join('\n')

    return `${data.kicker.toUpperCase()}\n${data.heading}\n${events}\nSee everything on this month: ${data.all_events_url}\n`
  },
})
