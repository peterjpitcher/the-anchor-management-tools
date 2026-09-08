import { z } from 'zod'

import { escapeEmailText } from '../escape'
import { defineBlock } from './types'

/**
 * The full week of opening times, laid out day by day in three columns.
 *
 * This is the one block in the library that is not a transcription of the designer's handover.
 * It reproduces the pub's printed "Opening times" sheet, which sets a day against its bar
 * hours and its kitchen hours side by side, with the two kitchen services labelled where a day
 * has both. `hours_table` cannot do that: it is two columns, its label cell is a fixed 140px
 * that wraps anything longer than "Saturday", and it was drawn for a single service window.
 *
 * The fixture is generated from `sample` rather than extracted from a designer file, so the
 * fidelity test locks this markup against accidental change rather than against a handover.
 *
 * Column widths are 130 / 175 / 187 inside the 536px panel, which measured in the fallback
 * fonts the clients actually use leaves room for the longest real values: "Wednesday" is 103px
 * of the 130, "12pm to 10pm" is 112px of the 163 usable, and a labelled "12pm to 3pm" is 103px
 * of the 132 left beside a "DINNER" label. On a phone the table scales and the longer times
 * wrap to two lines inside their own column, which stays readable because each column keeps
 * its own alignment.
 */

const kitchenServiceSchema = z.object({
  /** "Lunch" or "Dinner", set in the small gold caps the printed sheet uses. */
  label: z.string().min(1).max(10),
  time: z.string().min(1).max(24),
})

const openingTimesRowSchema = z.object({
  day: z.string().min(1).max(20),
  bar: z.string().min(1).max(24),
  /** The exception under the bar time, e.g. later closing on event nights. */
  bar_note: z.string().min(1).max(90).optional(),
  /**
   * One kitchen time, or the two services set against their own labels. A day with no kitchen
   * carries the words for it, e.g. "Kitchen closed", with `kitchen_muted` to grey it back.
   */
  kitchen: z.union([z.string().min(1).max(28), z.array(kitchenServiceSchema).min(1).max(2)]),
  kitchen_muted: z.boolean().optional(),
})

export const openingTimesSchema = z.object({
  heading: z.string().min(1).max(60),
  /** Sits under the heading in the script face, as the printed sheet does. */
  script_line: z.string().min(1).max(60).optional(),
  rows: z.array(openingTimesRowSchema).min(1).max(8),
  note: z.string().min(1).max(220),
})

export type OpeningTimesData = z.infer<typeof openingTimesSchema>
type OpeningTimesRow = z.infer<typeof openingTimesRowSchema>

const SANS = "'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif"
const SERIF = "'DM Serif Display',Georgia,'Times New Roman',serif"
const HAIRLINE = '#efe9dd'
const MICRO = `font-family:${SANS};font-size:10px;font-weight:600;line-height:16px;letter-spacing:0.16em;text-transform:uppercase;color:#8b6914`
const TIME = `font-family:${SANS};font-size:17px;font-weight:600;line-height:26px`

function columnHeader(label: string, width: number | null, padding: string): string {
  const sizing = width === null ? '' : ` width="${width}"`
  const widthStyle = width === null ? '' : `width:${width}px;`
  return `<td${sizing} valign="bottom" style="${widthStyle}padding:${padding};border-bottom:1px solid #e2dccf;${MICRO}">${escapeEmailText(label)}</td>`
}

/** The kitchen cell: one time, or the two labelled services stacked in their own table. */
function kitchenCell(row: OpeningTimesRow): string {
  if (typeof row.kitchen === 'string') {
    const colour = row.kitchen_muted ? '#6f6a61' : '#1a1a1a'
    return `<div style="${TIME};color:${colour}">${escapeEmailText(row.kitchen)}</div>`
  }

  const services = row.kitchen
    .map(
      (service) =>
        `<tr><td valign="middle" style="padding:0 10px 0 0;${MICRO}">${escapeEmailText(service.label)}</td><td valign="middle" style="${TIME};color:#1a1a1a">${escapeEmailText(service.time)}</td></tr>`,
    )
    .join('')

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tbody>${services}</tbody></table>`
}

function dayRow(row: OpeningTimesRow): string {
  const note = row.bar_note
    ? `<div style="font-family:${SANS};font-size:11px;line-height:16px;color:#6f6a61;padding-top:2px">${escapeEmailText(row.bar_note)}</div>`
    : ''

  return [
    `<tr>`,
    `<td width="130" valign="top" style="width:130px;padding:12px 0 12px 22px;border-bottom:1px solid ${HAIRLINE};font-family:${SERIF};font-size:20px;line-height:26px;color:#1a1a1a">${escapeEmailText(row.day)}</td>`,
    `<td width="175" valign="top" style="width:175px;padding:12px 12px 12px 0;border-bottom:1px solid ${HAIRLINE};${TIME};color:#1a1a1a">${escapeEmailText(row.bar)}${note}</td>`,
    `<td valign="top" style="padding:12px 22px 12px 0;border-bottom:1px solid ${HAIRLINE}">${kitchenCell(row)}</td>`,
    `</tr>`,
  ].join('')
}

export const openingTimes = defineBlock<OpeningTimesData>({
  type: 'opening_times',
  fixture: 'opening_times.html',
  schema: openingTimesSchema,
  sample: {
    heading: 'Opening times',
    script_line: "Where everyone's welcome",
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
    note: 'Last orders are 30 minutes before the kitchen closes, and 15 minutes before the bar does. Times may vary for private events and functions.',
  },
  render: (data) => `
<tr><td bgcolor="#ffffff" style="background-color:#ffffff;border-top:1px solid #e2dccf;border-bottom:1px solid #e2dccf;padding:0">
<table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse"><tbody>
<tr><td colspan="3" style="padding:22px 22px 0;font-family:${SERIF};font-size:26px;line-height:32px;letter-spacing:-0.01em;color:#005131">${escapeEmailText(data.heading)}</td></tr>${
    data.script_line
      ? `\n<tr><td colspan="3" style="padding:2px 22px 0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:15px;line-height:22px;color:#8b6914">${escapeEmailText(data.script_line)}</td></tr>`
      : ''
  }
<tr>${columnHeader('Day', 130, '18px 0 6px 22px')}${columnHeader('Bar', 175, '18px 12px 6px 0')}${columnHeader('Kitchen', null, '18px 22px 6px 0')}</tr>
${data.rows.map(dayRow).join('\n')}
<tr><td colspan="3" style="padding:12px 22px 20px;font-family:${SANS};font-size:13px;line-height:20px;color:#6f6a61">${escapeEmailText(data.note)}</td></tr>
</tbody></table>
</td></tr>
`,
  text: (data) =>
    `${data.heading.toUpperCase()}\n${data.rows
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
