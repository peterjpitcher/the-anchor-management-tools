import { z } from 'zod'

import { escapeEmailText } from '../escape'
import { defineBlock } from './types'

/**
 * The ordinary week: bar hours and kitchen hours, seven rows, three columns.
 *
 * `hours_table` is the green service-times panel and answers "when does the food stop".
 * This one answers "when are you open", which is the question a reader actually asks, and
 * it has to carry both because a bar time on its own sends someone out for a meal at 9pm.
 *
 * Columns are 150 / 160 / 226 and there is no `class="stack"` anywhere: three short columns
 * fit a 320px screen, and stacking them would turn one legible week into twenty-one
 * fragments with no way to tell a day from a service.
 *
 * The kitchen cell has exactly three states and a row must pick one:
 *
 *   `kitchen`            one service, one line
 *   `lunch` + `dinner`   two services, each behind a 56px label
 *   `closed: true`       "Kitchen closed", muted, so it reads as deliberate
 *
 * A row with two of them, or none, is a content bug that would render an empty cell, so the
 * schema rejects it rather than sending a day with no answer on it.
 *
 * Every value here is a fact about trading. Read the day from `business_hours` and then
 * check `special_hours` for the dates the email covers: an override always wins, and an
 * email that quotes the ordinary week through a bank holiday sends people to a locked door.
 */

const SANS = "'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif"
const SERIF = "'DM Serif Display',Georgia,'Times New Roman',serif"

const LABEL = `font-family:${SANS};font-size:11px;font-weight:600;line-height:16px;letter-spacing:0.14em;text-transform:uppercase;color:#8b6914`
const VALUE = `font-family:${SANS};font-size:15px;line-height:22px;color:#1a1a1a`
const MUTED = `font-family:${SANS};font-size:15px;line-height:22px;color:#6f6a61`
const NOTE = `font-family:${SANS};font-size:13px;line-height:20px;color:#6f6a61`

const openingHoursWeekRowSchema = z
  .object({
    day: z.string().min(1).max(20),
    /** Door to door, e.g. "12pm to 10pm". Never the kitchen's hours. */
    bar: z.string().min(1).max(40),
    /** One short line under the bar time, e.g. "Bank holidays from 12pm". */
    exception: z.string().min(1).max(60).optional(),
    /** One kitchen service across the day. */
    kitchen: z.string().min(1).max(40).optional(),
    /** Two kitchen services. Both or neither. */
    lunch: z.string().min(1).max(40).optional(),
    dinner: z.string().min(1).max(40).optional(),
    /** No food at all that day. */
    closed: z.boolean().optional(),
  })
  .superRefine((row, ctx) => {
    const states = [
      row.kitchen !== undefined,
      row.lunch !== undefined || row.dinner !== undefined,
      row.closed === true,
    ].filter(Boolean).length

    if (states !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `${row.day}: give the kitchen exactly one state, either "kitchen", or "lunch" and ` +
          '"dinner" together, or "closed": true',
      })
      return
    }

    if ((row.lunch === undefined) !== (row.dinner === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${row.day}: a two-service day needs both "lunch" and "dinner"`,
      })
    }
  })

export type OpeningHoursWeekRowData = z.infer<typeof openingHoursWeekRowSchema>

export const openingHoursWeekSchema = z.object({
  heading: z.string().min(1).max(120),
  /** Seven, because it is the week. A short table would leave a day unanswered. */
  rows: z.array(openingHoursWeekRowSchema).length(7),
  footnote: z.string().min(1).max(240),
})

export type OpeningHoursWeekData = z.infer<typeof openingHoursWeekSchema>

/** A labelled service line, e.g. LUNCH 12pm to 3pm. The label is set by the design. */
function serviceLine(label: string, time: string): string {
  return `<div style="${VALUE}"><span style="display:inline-block;width:56px;${LABEL}">${label}</span>${escapeEmailText(time)}</div>`
}

function kitchenCellContent(row: OpeningHoursWeekRowData): string {
  if (row.closed) return `<div style="${MUTED}">Kitchen closed</div>`
  if (row.kitchen !== undefined) return `<div style="${VALUE}">${escapeEmailText(row.kitchen)}</div>`

  return `${serviceLine('Lunch', row.lunch ?? '')}${serviceLine('Dinner', row.dinner ?? '')}`
}

function rowMarkup(row: OpeningHoursWeekRowData, isLast: boolean): string {
  // The last row sits on the table's own border, so a hairline there would double it.
  const hairline = isLast ? '' : 'border-bottom:1px solid #efe9dd;'
  const exception = row.exception ? `<div style="${NOTE}">${escapeEmailText(row.exception)}</div>` : ''

  return (
    `<tr>` +
    `<td width="150" valign="top" style="width:150px;padding:13px 0 13px 16px;${hairline}font-family:${SANS};font-size:15px;line-height:22px;color:#1a1a1a;font-weight:600">${escapeEmailText(row.day)}</td>` +
    `<td width="160" valign="top" style="width:160px;padding:13px 0 13px 12px;${hairline}"><div style="${VALUE}">${escapeEmailText(row.bar)}</div>${exception}</td>` +
    `<td width="226" valign="top" style="width:226px;padding:13px 16px 13px 12px;${hairline}">${kitchenCellContent(row)}</td>` +
    `</tr>`
  )
}

/** Column headings. Fixed by the design: the table only ever holds these three. */
const HEADER_ROW =
  `<tr>` +
  `<td width="150" style="width:150px;padding:12px 0 12px 16px;border-bottom:1px solid #e2dccf;${LABEL}">Day</td>` +
  `<td width="160" style="width:160px;padding:12px 0 12px 12px;border-bottom:1px solid #e2dccf;${LABEL}">Bar</td>` +
  `<td width="226" style="width:226px;padding:12px 16px 12px 12px;border-bottom:1px solid #e2dccf;${LABEL}">Kitchen</td>` +
  `</tr>`

export const openingHoursWeek = defineBlock<OpeningHoursWeekData>({
  type: 'opening_hours_week',
  fixture: 'lib_opening_hours_week.html',
  schema: openingHoursWeekSchema,
  sample: {
    heading: 'Opening times',
    rows: [
      { day: 'Monday', bar: '4pm to 10pm', exception: 'Bank holidays from 12pm', closed: true },
      { day: 'Tuesday', bar: '12pm to 10pm', lunch: '12pm to 3pm', dinner: '4pm to 9pm' },
      { day: 'Wednesday', bar: '12pm to 10pm', lunch: '12pm to 3pm', dinner: '4pm to 9pm' },
      { day: 'Thursday', bar: '12pm to 10pm', lunch: '12pm to 3pm', dinner: '4pm to 9pm' },
      { day: 'Friday', bar: '12pm to 11pm', lunch: '12pm to 3pm', dinner: '4pm to 9pm' },
      { day: 'Saturday', bar: '12pm to 11pm', kitchen: '1pm to 7pm' },
      { day: 'Sunday', bar: '12pm to 9pm', exception: 'Last entry 8.30pm', kitchen: '12pm to 5pm' },
    ],
    footnote:
      'Kitchen last orders are 15 minutes before each service ends. Weekend kitchen hours to be confirmed before send.',
  },
  render: (data) =>
    [
      `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#faf8f3"><tbody>`,
      `<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:32px 32px 14px;font-family:${SERIF};font-size:26px;line-height:32px;letter-spacing:-0.02em;color:#005131">${escapeEmailText(data.heading)}</td></tr>`,
      `<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:0 32px;"><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse;background-color:#ffffff;border:1px solid #e2dccf"><tbody>`,
      HEADER_ROW,
      ...data.rows.map((row, index) => rowMarkup(row, index === data.rows.length - 1)),
      `</tbody></table></td></tr>`,
      `<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:14px 32px 30px;font-family:${SANS};font-size:13px;line-height:20px;color:#6f6a61">${escapeEmailText(data.footnote)}</td></tr>`,
      `</tbody></table>`,
    ].join('\n'),
  text: (data) => {
    const rows = data.rows.map((row) => {
      const bar = row.exception ? `${row.bar} (${row.exception})` : row.bar
      const kitchen = row.closed
        ? 'kitchen closed'
        : row.kitchen !== undefined
          ? `kitchen ${row.kitchen}`
          : `lunch ${row.lunch}, dinner ${row.dinner}`
      return `${row.day}: bar ${bar}; ${kitchen}`
    })

    return `${data.heading}\n${rows.join('\n')}\n${data.footnote}\n`
  },
})
