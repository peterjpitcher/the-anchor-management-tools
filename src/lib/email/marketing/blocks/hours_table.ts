import { z } from 'zod'

import { escapeEmailText } from '../escape'
import { defineBlock } from './types'

/**
 * Green panel of service times: a gold kicker, label and time rows, then a note.
 *
 * Use it when the times themselves are the message, for example kitchen hours or a
 * seasonal change to opening. The times are right-aligned so a reader scanning the panel
 * gets a clean column of answers, and the note sits under a gold hairline for the one
 * exception people always ask about.
 */

export const hoursTableSchema = z.object({
  heading: z.string().min(1).max(80),
  rows: z
    .array(
      z.object({
        label: z.string().min(1).max(40),
        time: z.string().min(1).max(40),
      }),
    )
    .min(1)
    .max(8),
  note: z.string().min(1).max(160),
})

export type HoursTableData = z.infer<typeof hoursTableSchema>

export const hoursTable = defineBlock<HoursTableData>({
  type: 'hours_table',
  fixture: 'hours_table.html',
  schema: hoursTableSchema,
  sample: {
    heading: 'Kitchen hours, Tuesday to Friday',
    rows: [
      { label: 'Lunch', time: '12pm to 3pm' },
      { label: 'Dinner', time: '4pm to 9pm' },
    ],
    note: 'The kitchen is closed on Mondays.',
  },
  render: (data) =>
    `
<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:28px 32px 0">
<table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse;background-color:#005131"><tbody>
<tr><td colspan="2" style="padding:18px 22px 6px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;line-height:16px;letter-spacing:0.18em;text-transform:uppercase;color:#c9a020">${escapeEmailText(data.heading)}</td></tr>
${data.rows
  .map(
    (row) =>
      `<tr><td width="140" valign="top" style="width:140px;padding:8px 0 8px 22px;font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:22px;line-height:30px;color:#ffffff">${escapeEmailText(row.label)}</td><td valign="middle" align="right" style="padding:8px 22px 8px 0;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:18px;font-weight:600;line-height:30px;color:#f0e6c6">${escapeEmailText(row.time)}</td></tr>`,
  )
  .join('\n')}
<tr><td colspan="2" style="padding:12px 22px 20px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:#7a8b7f;border-top:1px solid rgba(201,160,32,0.3)">${escapeEmailText(data.note)}</td></tr>
</tbody></table>
</td></tr>
`,
  text: (data) =>
    `${data.heading.toUpperCase()}\n${data.rows
      .map((row) => `${row.label}: ${row.time}`)
      .join('\n')}\n${data.note}\n`,
})
