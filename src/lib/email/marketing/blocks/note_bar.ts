import { z } from 'zod'

import { escapeEmailText } from '../escape'
import { defineBlock } from './types'

/**
 * Small white strip with a gold left border, for a rule, a deadline or a closure.
 *
 * The quiet counterpart to `deadline_bar`: use this when the reader needs to know something,
 * and the gold bar only when there is a real constraint worth shouting about.
 *
 * The designer's library file bundles this markup inside the `pull_quote` marker. The
 * extraction script splits the two and proves the halves reassemble into the original byte
 * for byte, so this block is genuine transcription rather than something invented here.
 */

export const noteBarSchema = z.object({
  /** Short lead-in, rendered in green. The full stop is part of the supplied copy. */
  label: z.string().min(1).max(60),
  body: z.string().min(1).max(240),
})

export type NoteBarData = z.infer<typeof noteBarSchema>

export const noteBar = defineBlock<NoteBarData>({
  type: 'note_bar',
  fixture: 'lib_note_bar.html',
  schema: noteBarSchema,
  sample: {
    label: 'Please note.',
    body: 'A single-line notice bar for a rule, a deadline or a closure.',
  },
  render: (data) =>
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#faf8f3"><tbody>
<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:24px 32px"><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse;background-color:#ffffff;border-left:3px solid #a57626"><tbody><tr><td style="padding:14px 18px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:#1a1a1a"><strong style="color:#005131">${escapeEmailText(data.label)}</strong> ${escapeEmailText(data.body)}</td></tr></tbody></table></td></tr>
</tbody></table>`,
  text: (data) => `${data.label} ${data.body}\n`,
})
