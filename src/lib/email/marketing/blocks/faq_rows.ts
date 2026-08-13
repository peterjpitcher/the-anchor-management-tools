import { z } from 'zod'

import { escapeEmailText } from '../escape'
import { defineBlock } from './types'

/**
 * A short run of questions and answers, question in green semibold with the answer under it.
 *
 * This block exists to pre-empt the two or three worries that quietly stop a booking, so
 * keep it to the real objections and answer them plainly. It is not a place to restate the
 * offer.
 *
 * The hairline sits under every answer except the last, which closes the run without a
 * stray rule, so the answer markup varies by position.
 */

const faqItemSchema = z.object({
  question: z.string().min(1).max(160),
  answer: z.string().min(1).max(400),
})

export type FaqItemData = z.infer<typeof faqItemSchema>

export const faqRowsSchema = z.object({
  heading: z.string().min(1).max(120),
  items: z.array(faqItemSchema).min(1).max(8),
})

export type FaqRowsData = z.infer<typeof faqRowsSchema>

function faqItemMarkup(item: FaqItemData, isLast: boolean): string {
  const answerStyle = isLast ? 'padding:4px 0 0;' : 'padding:4px 0 14px;border-bottom:1px solid #efe9dd;'

  return `<tr><td style="padding:16px 0 0;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;line-height:24px;color:#005131">${escapeEmailText(item.question)}</td></tr>
<tr><td style="${answerStyle}font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:23px;color:#1a1a1a">${escapeEmailText(item.answer)}</td></tr>`
}

export const faqRows = defineBlock<FaqRowsData>({
  type: 'faq_rows',
  fixture: 'lib_faq_rows.html',
  schema: faqRowsSchema,
  sample: {
    heading: 'Asked a lot',
    items: [
      {
        question: 'Will we share a room with other groups?',
        answer:
          'No. Every Christmas booking here is your own group and nobody else, at your own table.',
      },
      {
        question: 'What if we are fewer than 6?',
        answer:
          'Smaller groups are very welcome from the regular menu. The 6-guest minimum is for the Christmas menu only.',
      },
    ],
  },
  render: (data) =>
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#faf8f3"><tbody>
<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:32px 32px 6px;font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:26px;line-height:32px;letter-spacing:-0.02em;color:#005131">${escapeEmailText(data.heading)}</td></tr>
<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:0 32px 30px"><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse"><tbody>
${data.items
  .map((item, index) => faqItemMarkup(item, index === data.items.length - 1))
  .join('\n')}
</tbody></table></td></tr>
</tbody></table>`,
  text: (data) => {
    const items = data.items.map((item) => `${item.question}\n${item.answer}`).join('\n\n')

    return `${data.heading}\n\n${items}\n`
  },
})
