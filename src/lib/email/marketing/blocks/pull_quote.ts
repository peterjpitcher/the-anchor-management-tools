import { z } from 'zod'

import { escapeEmailText } from '../escape'
import { defineBlock } from './types'

/**
 * Clicker Script line on sand, for a moment of brand warmth.
 *
 * Maximum one per email. It is a brand rule, not a style preference: the script face reads
 * as a warm aside, and an aside repeated stops being one.
 *
 * Transcription note. The designer's library file bundles this block and `note_bar` under a
 * single BLOCK marker, which looks like a missing pair of markers rather than a decision:
 * `note_bar` is its own entry in their catalogue. The extraction script splits the two and
 * proves the halves reassemble into the original, so both are usable without a re-export.
 */

export const pullQuoteSchema = z.object({
  script_line: z.string().min(1).max(80),
  body: z.string().min(1).max(240),
})

export type PullQuoteData = z.infer<typeof pullQuoteSchema>

export const pullQuote = defineBlock<PullQuoteData>({
  type: 'pull_quote',
  fixture: 'lib_pull_quote.html',
  schema: pullQuoteSchema,
  sample: {
    script_line: 'A village pub since 1751',
    body: 'We stood here before Heathrow existed. One warm aside, used sparingly.',
  },
  render: (data) =>
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#faf8f3"><tbody>
<tr><td bgcolor="#f5e6d3" align="center" style="background-color:#f5e6d3;padding:34px 44px"><div style="font-family:'Clicker Script','Segoe Script','Brush Script MT',cursive;font-size:34px;line-height:42px;color:#8b6914;padding-bottom:8px">${escapeEmailText(data.script_line)}</div><div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:#1a1a1a">${escapeEmailText(data.body)}</div></td></tr>
</tbody></table>`,
  text: (data) =>
    `${data.script_line}\n${data.body}\n`,
})
