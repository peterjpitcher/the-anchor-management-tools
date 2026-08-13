import { z } from 'zod'

import { escapeEmailText } from '../escape'
import { defineBlock } from './types'

/**
 * Three green ticks on one quiet line, sitting directly under a call to action.
 *
 * It answers the small fears that stop a click: that enquiring commits you to something,
 * that nobody will reply, that parking will be a problem. Keep each one short enough to
 * stay on a single line at 600px.
 */

/** Fixed at three: the row is designed as one centred line and a fourth tick wraps badly. */
export const reassuranceRowSchema = z.object({
  items: z.array(z.string().min(1).max(48)).length(3),
})

export type ReassuranceRowData = z.infer<typeof reassuranceRowSchema>

const TICK = '<span style="color:#006b45;font-weight:600">&#10003;</span>&nbsp; '

export const reassuranceRow = defineBlock<ReassuranceRowData>({
  type: 'reassurance_row',
  fixture: 'lib_reassurance_row.html',
  schema: reassuranceRowSchema,
  sample: {
    items: ['No commitment, just a conversation', 'We reply within 24 hours', 'Free customer parking'],
  },
  render: (data) =>
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#faf8f3"><tbody>
<tr><td bgcolor="#faf8f3" align="center" style="background-color:#faf8f3;padding:18px 32px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;line-height:22px;color:#6f6a61">${data.items
      .map((item) => `${TICK}${escapeEmailText(item)}`)
      .join(' &nbsp;&nbsp;')}</td></tr>
</tbody></table>`,
  text: (data) => `${data.items.map((item) => `- ${item}`).join('\n')}\n`,
})
