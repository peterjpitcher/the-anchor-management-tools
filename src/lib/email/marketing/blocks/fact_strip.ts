import { z } from 'zod'

import { escapeEmailText } from '../escape'
import { defineBlock } from './types'

/**
 * White strip of label and value rows, ruled off top and bottom.
 *
 * Use it for the rules and constraints a reader scans before deciding: dates, sittings,
 * group size, deposit. Anything a guest would otherwise have to email and ask about.
 *
 * The last row deliberately drops its hairline so the strip closes on its own border rather
 * than doubling up.
 */

const factStripRowSchema = z.object({
  label: z.string().min(1).max(40),
  value: z.string().min(1).max(160),
})

export const factStripSchema = z.object({
  rows: z.array(factStripRowSchema).min(1).max(8),
})

export type FactStripData = z.infer<typeof factStripSchema>

export const factStrip = defineBlock<FactStripData>({
  type: 'fact_strip',
  fixture: 'fact_strip.html',
  schema: factStripSchema,
  sample: {
    rows: [
      { label: 'Dates', value: '10 November to 20 December 2026' },
      { label: 'Sittings', value: 'Tuesday to Saturday, plus Sunday 1pm to 6pm. No Mondays' },
      { label: 'Group size', value: '6 guests or more. Over 20 becomes private hire' },
      { label: 'Deposit', value: '£10 per person, taken off your bill' },
    ],
  },
  render: (data) => `
<tr><td bgcolor="#ffffff" style="background-color:#ffffff;border-top:1px solid #e2dccf;border-bottom:1px solid #e2dccf;padding:8px 32px 12px">
<table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse"><tbody>
${data.rows
  .map((row, index) => {
    const rule = index === data.rows.length - 1 ? '' : 'border-bottom:1px solid #efe9dd;'
    return `<tr><td width="150" style="width:150px;padding:14px 0;${rule}font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;line-height:18px;letter-spacing:0.14em;text-transform:uppercase;color:#8b6914" valign="top">${escapeEmailText(row.label)}</td><td style="padding:14px 0;${rule}font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:#1a1a1a" valign="top">${escapeEmailText(row.value)}</td></tr>`
  })
  .join('\n')}
</tbody></table>
</td></tr>
`,
  text: (data) => `${data.rows.map((row) => `${row.label}: ${row.value}`).join('\n')}\n`,
})
