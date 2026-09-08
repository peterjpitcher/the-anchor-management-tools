import { z } from 'zod'

import { escapeEmailText } from '../escape'
import { defineBlock } from './types'

/**
 * Dated exceptions, for the runs where the ordinary week stops being true.
 *
 * Christmas and New Year is the case that forced it: seventeen dated exceptions between
 * 22 December and 10 January, two of them full closures. `opening_hours_week` cannot say
 * any of that, because it repeats a week, and a repeating week through that fortnight is
 * simply wrong.
 *
 * Same geometry as the week table, so the two sit together in one email without looking
 * like two different products. A 112px date column, then a nested full-width table of an
 * hours cell and a note cell, both carrying `class="stack"`: three columns at 600px,
 * hours over note on a phone. The date and the hours are both `white-space:nowrap`, because
 * "Tue 22 Dec" broken across two lines is worse than a narrower note beside it.
 *
 * A closed day renders as a full dark row: `#0c1d11` across both cells, the date in gold and
 * "Closed" in cream. Nothing else in the library does this, and that is the point. A closure
 * set in the same grey as a quiet Tuesday gets skimmed past, and somebody drives over on
 * Christmas Day.
 *
 * Every date belongs in `special_hours`. Read them from there rather than from a poster or
 * a memory of last year: that record is what the website, the booking system and the phone
 * line all answer from, and an email that disagrees with it is the one that is wrong.
 */

const SANS = "'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif"
const SERIF = "'DM Serif Display',Georgia,'Times New Roman',serif"

const DARK = '#0c1d11'
const HAIRLINE = 'border-bottom:1px solid #efe9dd;'

const openingHoursDatesRowSchema = z
  .object({
    /** Weekday and date, e.g. "Fri 25 Dec". Spell the date out: this table is the exception. */
    date: z.string().min(1).max(24),
    /** Door to door on that date. Omit only when the day is closed. */
    hours: z.string().min(1).max(40).optional(),
    /** Closed all day. Renders as the dark row. */
    closed: z.boolean().optional(),
    /** Why this date differs, or what is on. One short line. */
    note: z.string().min(1).max(90).optional(),
  })
  .superRefine((row, ctx) => {
    if (row.closed === true && row.hours !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${row.date}: a closed day cannot also have hours`,
      })
    }
    if (row.closed !== true && row.hours === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${row.date}: give the day either "hours" or "closed": true`,
      })
    }
  })

export type OpeningHoursDatesRowData = z.infer<typeof openingHoursDatesRowSchema>

export const openingHoursDatesSchema = z.object({
  heading: z.string().min(1).max(120),
  /** Twelve rows is about the limit before the table stops being scannable. */
  rows: z.array(openingHoursDatesRowSchema).min(1).max(12),
  footnote: z.string().min(1).max(240),
})

export type OpeningHoursDatesData = z.infer<typeof openingHoursDatesSchema>

/**
 * The nested hours-and-note table shared by both row treatments.
 *
 * Both cells carry `class="stack"`, which is what makes the row three columns on a desktop
 * and hours-over-note on a phone. The colours differ between an open day and a closed one
 * and nothing else does, so they are passed in rather than duplicating the geometry twice
 * and letting the two drift apart.
 */
function hoursAndNote(hours: string, note: string, hoursStyle: string, noteColour: string): string {
  const noteDiv = note
    ? `<div style="font-family:${SANS};font-size:13px;line-height:20px;color:${noteColour}">${escapeEmailText(note)}</div>`
    : ''

  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse"><tbody><tr>` +
    `<td width="150" valign="top" class="stack" style="width:150px;padding:0 8px 0 0"><div style="${hoursStyle}">${escapeEmailText(hours)}</div></td>` +
    `<td valign="top" class="stack" style="padding:1px 0 0">${noteDiv}</td>` +
    `</tr></tbody></table>`
  )
}

/** The dark treatment, reserved for a day the pub is shut. */
function closedRowMarkup(row: OpeningHoursDatesRowData): string {
  const inner = hoursAndNote(
    'Closed',
    row.note ?? '',
    `font-family:${SANS};font-size:15px;font-weight:600;line-height:22px;color:#f0e6c6;white-space:nowrap`,
    '#f0e6c6',
  )

  return (
    `<tr>` +
    `<td width="112" valign="top" bgcolor="${DARK}" style="width:112px;background-color:${DARK};padding:13px 0 13px 12px;font-family:${SANS};font-size:15px;font-weight:600;line-height:22px;color:#c9a020;white-space:nowrap">${escapeEmailText(row.date)}</td>` +
    `<td valign="top" bgcolor="${DARK}" style="background-color:${DARK};padding:13px 10px 13px 4px">${inner}</td>` +
    `</tr>`
  )
}

function openRowMarkup(row: OpeningHoursDatesRowData, isLast: boolean): string {
  // The last row sits on the table's own border, so a hairline there would double it.
  const hairline = isLast ? '' : HAIRLINE
  const inner = hoursAndNote(
    row.hours ?? '',
    row.note ?? '',
    `font-family:${SANS};font-size:15px;line-height:22px;color:#1a1a1a;white-space:nowrap`,
    '#6f6a61',
  )

  return (
    `<tr>` +
    `<td width="112" valign="top" style="width:112px;padding:13px 0 13px 12px;${hairline}font-family:${SANS};font-size:15px;line-height:22px;color:#1a1a1a;font-weight:600;white-space:nowrap">${escapeEmailText(row.date)}</td>` +
    `<td valign="top" style="padding:13px 10px 13px 4px;${hairline}">${inner}</td>` +
    `</tr>`
  )
}

export const openingHoursDates = defineBlock<OpeningHoursDatesData>({
  type: 'opening_hours_dates',
  fixture: 'lib_opening_hours_dates.html',
  schema: openingHoursDatesSchema,
  sample: {
    heading: 'Christmas and New Year',
    rows: [
      { date: 'Tue 22 Dec', hours: '12pm to 10pm', note: 'Drinks only, no food' },
      { date: 'Wed 23 Dec', hours: '12pm to 10pm', note: 'Drinks only, no food' },
      { date: 'Thu 24 Dec', hours: '12pm to 6pm', note: 'Christmas Eve, drinks only' },
      { date: 'Fri 25 Dec', closed: true, note: 'Christmas Day. Happy Christmas from all of us' },
      { date: 'Sat 26 Dec', hours: '12pm to 6pm', note: 'Boxing Day, drinks only' },
      { date: 'Sun 27 Dec', hours: '12pm to 6pm', note: 'Drinks only, no food' },
      { date: 'Mon 28 Dec', hours: '12pm to 10pm', note: 'Bank holiday hours, drinks only' },
      { date: 'Thu 31 Dec', hours: '12pm to 1am', note: 'New Year’s Eve, drinks only' },
      { date: 'Fri 1 Jan', closed: true, note: 'New Year’s Day' },
      { date: 'Sat 2 Jan', hours: '12pm to 11pm', note: 'Drinks only, no food' },
      { date: 'Sun 10 Jan', hours: '12pm to 9pm', note: 'Kitchen back to normal from Tuesday 12 January' },
    ],
    footnote:
      'Where no note is shown the kitchen runs its usual hours. Every date above is read from our opening hours records.',
  },
  render: (data) =>
    [
      `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#faf8f3"><tbody>`,
      `<tr><td bgcolor="#faf8f3" class="gutter" style="background-color:#faf8f3;padding:32px 32px 14px;font-family:${SERIF};font-size:26px;line-height:32px;letter-spacing:-0.02em;color:#005131">${escapeEmailText(data.heading)}</td></tr>`,
      `<tr><td bgcolor="#faf8f3" class="gutter" style="background-color:#faf8f3;padding:0 32px;"><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse;background-color:#ffffff;border:1px solid #e2dccf"><tbody>`,
      ...data.rows.map((row, index) =>
        row.closed ? closedRowMarkup(row) : openRowMarkup(row, index === data.rows.length - 1),
      ),
      `</tbody></table></td></tr>`,
      `<tr><td bgcolor="#faf8f3" class="gutter" style="background-color:#faf8f3;padding:14px 32px 30px;font-family:${SANS};font-size:13px;line-height:20px;color:#6f6a61">${escapeEmailText(data.footnote)}</td></tr>`,
      `</tbody></table>`,
    ].join('\n'),
  text: (data) => {
    const rows = data.rows.map((row) => {
      const hours = row.closed ? 'Closed' : (row.hours ?? '')
      return row.note ? `${row.date}: ${hours}. ${row.note}` : `${row.date}: ${hours}`
    })

    return `${data.heading}\n${rows.join('\n')}\n${data.footnote}\n`
  },
})
