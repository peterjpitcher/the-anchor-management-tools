import { z } from 'zod'

import { escapeEmailText } from '../escape'
import { defineBlock } from './types'

/**
 * Clicker Script line on sand, for a moment of brand warmth.
 *
 * Maximum one per email. It is a brand rule, not a style preference: the script face reads
 * as a warm aside, and an aside repeated stops being one.
 *
 * Transcription note. The designer's library groups the sand quote panel and the small
 * `note_bar` strip under one section, so the fixture for this block contains both and the
 * notice row below is fixed markup rather than a slot. If a campaign needs its own notice
 * text, `note_bar` is a separate entry in the block catalogue and needs its own module.
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
<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:24px 32px"><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse;background-color:#ffffff;border-left:3px solid #a57626"><tbody><tr><td style="padding:14px 18px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:#1a1a1a"><strong style="color:#005131">Please note.</strong> A single-line notice bar for a rule, a deadline or a closure.</td></tr></tbody></table></td></tr>
</tbody></table>`,
  text: (data) =>
    `${data.script_line}\n${data.body}\n\nPlease note. A single-line notice bar for a rule, a deadline or a closure.\n`,
})
