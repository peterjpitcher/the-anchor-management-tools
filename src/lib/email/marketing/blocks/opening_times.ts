import { z } from 'zod'

import { escapeEmailText } from '../escape'
import { defineBlock } from './types'

/**
 * The full week of opening times: a day against its bar hours and its kitchen hours.
 *
 * This is the one block in the library that is not a transcription of the designer's handover.
 * It reproduces the pub's printed opening-times sheet, which `hours_table` cannot do: that
 * block is two columns, its label cell is a fixed 140px that wraps anything longer than
 * "Saturday", and it was drawn for a single service window.
 *
 * Because there is no handover to copy, it is built to `fact_strip`, its nearest sibling and
 * the block the handover uses for exactly this job, "the rules and constraints a reader scans
 * before deciding". Everything structural is taken from there rather than invented: the white
 * panel ruled off top and bottom in #e2dccf, the outer `8px 32px 12px` that puts the content
 * on the same 536px measure as every other block, the inner table, the #efe9dd row hairline,
 * the 11px 0.14em gold caps for a label, and 15px/22px #1a1a1a for a value. The day takes the
 * 19px serif in #005131 that `whats_on_list` gives its date badge, because the day is the key
 * a reader scans for.
 *
 * The fixture is generated from `sample`, so the fidelity test locks this markup against
 * accidental change rather than against a designer file.
 *
 * Columns are 150 / 160 / 226 inside the 536px measure. Measured in the fallback fonts the
 * clients actually use, that leaves room for every real value: "Wednesday" is 97px of the 150,
 * "12pm to 10pm" is 94px of the 148 usable, and a "DINNER" label plus "12pm to 3pm" is 139px
 * of the 226. `bar_note` sits in the 148px bar column, so keep it to about 24 characters or it
 * wraps to three lines; anything longer belongs in `note`, which has the full width.
 */

const kitchenServiceSchema = z.object({
  /** "Lunch" or "Dinner", set in the same gold caps `fact_strip` gives a label. */
  label: z.string().min(1).max(10),
  time: z.string().min(1).max(24),
})

const openingTimesRowSchema = z.object({
  day: z.string().min(1).max(20),
  bar: z.string().min(1).max(24),
  /** A short exception under the bar time. Keep it to about 24 characters, see above. */
  bar_note: z.string().min(1).max(40).optional(),
  /**
   * One kitchen time, or the two services set against their own labels. A day with no kitchen
   * carries the words for it, e.g. "Kitchen closed", with `kitchen_muted` to grey it back.
   */
  kitchen: z.union([z.string().min(1).max(28), z.array(kitchenServiceSchema).min(1).max(2)]),
  kitchen_muted: z.boolean().optional(),
})

export const openingTimesSchema = z.object({
  /** Optional gold kicker above the table, the way `hours_table` titles its panel. */
  heading: z.string().min(1).max(60).optional(),
  rows: z.array(openingTimesRowSchema).min(1).max(8),
  note: z.string().min(1).max(220),
})

export type OpeningTimesData = z.infer<typeof openingTimesSchema>
type OpeningTimesRow = z.infer<typeof openingTimesRowSchema>

const SANS = "'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif"
const SERIF = "'DM Serif Display',Georgia,'Times New Roman',serif"
const HAIRLINE = 'border-bottom:1px solid #efe9dd'
/** `fact_strip`'s label type, to the character. */
const LABEL = `font-family:${SANS};font-size:11px;font-weight:600;line-height:18px;letter-spacing:0.14em;text-transform:uppercase;color:#8b6914`
/** The same caps in the muted grey, so the column headers sit under the gold kicker. */
const COLUMN = `font-family:${SANS};font-size:11px;font-weight:600;line-height:18px;letter-spacing:0.14em;text-transform:uppercase;color:#6f6a61`
/** `fact_strip`'s value type. */
const VALUE = `font-family:${SANS};font-size:15px;line-height:22px;color:#1a1a1a`

/** The kitchen cell: one time, or the two labelled services stacked in their own table. */
function kitchenCell(row: OpeningTimesRow): string {
  if (typeof row.kitchen === 'string') {
    const colour = row.kitchen_muted ? '#6f6a61' : '#1a1a1a'
    return `<div style="font-family:${SANS};font-size:15px;line-height:22px;color:${colour}">${escapeEmailText(row.kitchen)}</div>`
  }

  const services = row.kitchen
    .map(
      (service) =>
        `<tr><td valign="top" style="padding:0 10px 0 0;${LABEL}">${escapeEmailText(service.label)}</td><td valign="top" style="${VALUE}">${escapeEmailText(service.time)}</td></tr>`,
    )
    .join('')

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tbody>${services}</tbody></table>`
}

function dayRow(row: OpeningTimesRow): string {
  const note = row.bar_note
    ? `<div style="font-family:${SANS};font-size:12px;line-height:18px;color:#6f6a61">${escapeEmailText(row.bar_note)}</div>`
    : ''

  return (
    `<tr><td width="150" valign="top" style="width:150px;padding:14px 0;${HAIRLINE};font-family:${SERIF};font-size:19px;line-height:25px;color:#005131">${escapeEmailText(row.day)}</td>` +
    `<td width="160" valign="top" style="width:160px;padding:14px 12px 14px 0;${HAIRLINE};${VALUE}">${escapeEmailText(row.bar)}${note}</td>` +
    `<td valign="top" style="padding:14px 0;${HAIRLINE}">${kitchenCell(row)}</td></tr>`
  )
}

export const openingTimes = defineBlock<OpeningTimesData>({
  type: 'opening_times',
  fixture: 'opening_times.html',
  schema: openingTimesSchema,
  sample: {
    heading: 'Opening times',
    rows: [
      { day: 'Monday', bar: '4pm to 10pm', kitchen: 'Kitchen closed', kitchen_muted: true },
      {
        day: 'Tuesday',
        bar: '12pm to 10pm',
        kitchen: [
          { label: 'Lunch', time: '12pm to 3pm' },
          { label: 'Dinner', time: '4pm to 9pm' },
        ],
      },
      { day: 'Saturday', bar: '12pm to 10pm', kitchen: '12pm to 7pm' },
      { day: 'Sunday', bar: '12pm to 10pm', kitchen: '1pm to 6pm' },
    ],
    note: 'Last orders are 30 minutes before the kitchen closes, and 15 minutes before the bar does.',
  },
  render: (data) => `
<tr><td bgcolor="#ffffff" style="background-color:#ffffff;border-top:1px solid #e2dccf;border-bottom:1px solid #e2dccf;padding:8px 32px 12px">
<table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse"><tbody>${
    data.heading
      ? `\n<tr><td colspan="3" style="padding:14px 0 0;${LABEL}">${escapeEmailText(data.heading)}</td></tr>`
      : ''
  }
<tr><td width="150" valign="bottom" style="width:150px;padding:12px 0 6px;${HAIRLINE};${COLUMN}">Day</td><td width="160" valign="bottom" style="width:160px;padding:12px 12px 6px 0;${HAIRLINE};${COLUMN}">Bar</td><td valign="bottom" style="padding:12px 0 6px;${HAIRLINE};${COLUMN}">Kitchen</td></tr>
${data.rows.map(dayRow).join('\n')}
<tr><td colspan="3" style="padding:14px 0 0;font-family:${SANS};font-size:13px;line-height:20px;color:#6f6a61">${escapeEmailText(data.note)}</td></tr>
</tbody></table>
</td></tr>
`,
  text: (data) =>
    `${(data.heading ?? 'Opening times').toUpperCase()}\n${data.rows
      .map((row) => {
        const kitchen =
          typeof row.kitchen === 'string'
            ? row.kitchen
            : row.kitchen.map((service) => `${service.label} ${service.time}`).join(', ')
        const note = row.bar_note ? ` (${row.bar_note})` : ''
        return `${row.day}: bar ${row.bar}${note}, kitchen ${kitchen}`
      })
      .join('\n')}\n${data.note}\n`,
})
