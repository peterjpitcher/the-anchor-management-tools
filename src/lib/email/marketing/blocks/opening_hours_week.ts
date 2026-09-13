import { z } from 'zod'

import { escapeEmailText } from '../escape'
import { defineBlock } from './types'

/**
 * The ordinary week: bar hours and kitchen hours, seven rows, two columns.
 *
 * `hours_table` is the green service-times panel and answers "when does the food stop".
 * This one answers "when are you open", which is the question a reader actually asks, and
 * it has to carry both, because a bar time on its own sends someone out for a meal at 9pm.
 *
 * Redrawn twice. The first version was three real columns, day against bar against kitchen,
 * which is the shape of the pub's printed sheet; on a 360px phone they squeezed and the
 * times wrapped mid-value. The second was mobile-first, a day column and one details cell
 * of labelled lines, which read well on a phone and left the right half of the 536px table
 * empty on a desktop.
 *
 * This is both. The day cell is fixed at 112px. The details cell holds a nested full-width
 * table of two cells, bar and kitchen, and both carry `class="stack"`, so the row is three
 * columns at 600px and folds to "BAR 12pm to 10pm / LUNCH 12pm to 3pm / DINNER 4pm to 9pm"
 * down the cell on a phone. Every time is `white-space:nowrap`, so a time can never break
 * in half at either width.
 *
 * The day column itself never stacks. A week where the day and its hours could separate
 * would be fourteen fragments with no way to tell one from the other.
 *
 * The kitchen has exactly three states and a row must pick one:
 *
 *   `kitchen`            one service, one labelled line
 *   `lunch` + `dinner`   two services, two labelled lines
 *   `closed: true`       "KITCHEN Closed", muted, so it reads as deliberate
 *
 * A row with two of them, or none, is a content bug that would render a day with no answer
 * on it, so the schema rejects it rather than sending it.
 *
 * Every value here is a fact about trading. Read the day from `business_hours` and then
 * check `special_hours` for the dates the email covers: an override always wins, and an
 * email that quotes the ordinary week through a bank holiday sends people to a locked door.
 */

const SANS = "'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif"
const SERIF = "'DM Serif Display',Georgia,'Times New Roman',serif"

/** The 68px inline label in front of every value: BAR, LUNCH, DINNER, KITCHEN. */
const LABEL = `font-family:${SANS};font-size:11px;font-weight:600;line-height:16px;letter-spacing:0.14em;text-transform:uppercase;color:#8b6914`
const VALUE_LINE = `font-family:${SANS};font-size:15px;line-height:22px;color:#1a1a1a;white-space:nowrap`
const MUTED_LINE = `font-family:${SANS};font-size:15px;line-height:22px;color:#6f6a61;white-space:nowrap`
const NOTE = `font-family:${SANS};font-size:13px;line-height:20px;color:#6f6a61;padding-top:2px`

const openingHoursWeekRowSchema = z
  .object({
    day: z.string().min(1).max(20),
    /** Door to door, e.g. "12pm to 10pm". Never the kitchen's hours. */
    bar: z.string().min(1).max(40),
    /** One short line at the foot of the cell, e.g. "Bank holidays from 12pm". */
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

/**
 * One labelled line, e.g. BAR 12pm to 10pm.
 *
 * The value carries its own `white-space:nowrap` as well as the line, because a client that
 * drops the div's style must still not break "12pm to 10pm" across two lines.
 */
function labelledLine(label: string, value: string, muted = false): string {
  return `<div style="${muted ? MUTED_LINE : VALUE_LINE}"><span style="display:inline-block;width:68px;${LABEL}">${label}</span><span style="white-space:nowrap">${escapeEmailText(value)}</span></div>`
}

function kitchenLines(row: OpeningHoursWeekRowData): string {
  if (row.closed) return labelledLine('Kitchen', 'Closed', true)
  if (row.kitchen !== undefined) return labelledLine('Kitchen', row.kitchen)

  return `${labelledLine('Lunch', row.lunch ?? '')}${labelledLine('Dinner', row.dinner ?? '')}`
}

function rowMarkup(row: OpeningHoursWeekRowData, isLast: boolean): string {
  // The last row sits on the table's own border, so a hairline there would double it.
  const hairline = isLast ? '' : 'border-bottom:1px solid #efe9dd;'

  // The note sits outside the nested table on purpose, so it reads last at both widths
  // rather than being pulled up beside the bar time when the two columns stack.
  const exception = row.exception ? `<div style="${NOTE}">${escapeEmailText(row.exception)}</div>` : ''

  return (
    `<tr>` +
    `<td width="112" valign="top" style="width:112px;padding:13px 0 13px 12px;${hairline}font-family:${SANS};font-size:15px;line-height:22px;color:#1a1a1a;font-weight:600">${escapeEmailText(row.day)}</td>` +
    `<td valign="top" style="padding:13px 10px 13px 4px;${hairline}">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse"><tbody><tr>` +
    `<td width="176" valign="top" class="stack" style="width:176px;padding:0 8px 0 0">${labelledLine('Bar', row.bar)}</td>` +
    `<td valign="top" class="stack" style="padding:0">${kitchenLines(row)}</td>` +
    `</tr></tbody></table>${exception}</td>` +
    `</tr>`
  )
}

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
      'Kitchen last orders are 30 minutes before each service ends. Weekend kitchen hours to be confirmed before send.',
  },
  render: (data) =>
    [
      `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#faf8f3"><tbody>`,
      `<tr><td bgcolor="#faf8f3" class="gutter" style="background-color:#faf8f3;padding:32px 32px 14px;font-family:${SERIF};font-size:26px;line-height:32px;letter-spacing:-0.02em;color:#005131">${escapeEmailText(data.heading)}</td></tr>`,
      `<tr><td bgcolor="#faf8f3" class="gutter" style="background-color:#faf8f3;padding:0 32px;"><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse;background-color:#ffffff;border:1px solid #e2dccf"><tbody>`,
      ...data.rows.map((row, index) => rowMarkup(row, index === data.rows.length - 1)),
      `</tbody></table></td></tr>`,
      `<tr><td bgcolor="#faf8f3" class="gutter" style="background-color:#faf8f3;padding:14px 32px 30px;font-family:${SANS};font-size:13px;line-height:20px;color:#6f6a61">${escapeEmailText(data.footnote)}</td></tr>`,
      `</tbody></table>`,
    ].join('\n'),
  text: (data) => {
    const rows = data.rows.map((row) => {
      const kitchen = row.closed
        ? 'kitchen closed'
        : row.kitchen !== undefined
          ? `kitchen ${row.kitchen}`
          : `lunch ${row.lunch}, dinner ${row.dinner}`
      const exception = row.exception ? ` (${row.exception})` : ''
      return `${row.day}: bar ${row.bar}; ${kitchen}${exception}`
    })

    return `${data.heading}\n${rows.join('\n')}\n${data.footnote}\n`
  },
})
