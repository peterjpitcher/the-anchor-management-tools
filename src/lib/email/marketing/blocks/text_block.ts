import { z } from 'zod'

import { escapeEmailText, escapeEmailUrl } from '../escape'
import { defineBlock } from './types'

/**
 * The workhorse block: a heading, one or two paragraphs, then an optional list of points.
 *
 * The list is built from real table rows rather than a `<ul>`, because Outlook mangles list
 * indentation. The button row and the closing hairline are both part of the designer's
 * section for this block: buttons are optional slots, and the hairline always closes the
 * block because it carries the bottom padding.
 */

const textBlockButtonSchema = z.object({
  label: z.string().min(1).max(60),
  url: z.string().min(1),
  variant: z.enum(['primary', 'outline', 'ghost']),
})

export const textBlockSchema = z.object({
  heading: z.string().min(1).max(120),
  body: z.array(z.string().min(1).max(600)).max(4).optional(),
  list_items: z.array(z.string().min(1).max(200)).max(8).optional(),
  buttons: z.array(textBlockButtonSchema).max(3).optional(),
})

export type TextBlockData = z.infer<typeof textBlockSchema>

type TextBlockButton = z.infer<typeof textBlockButtonSchema>

function buttonCell(button: TextBlockButton): string {
  const href = escapeEmailUrl(button.url)
  const label = escapeEmailText(button.label)

  if (button.variant === 'primary') {
    // Colour deviation from the handover. The owner asked for white text on every gold fill.
    // White on the designer's #a57626 measures 4.02:1, which only clears AA for large text and
    // this label is 15px, so the fill darkens to the palette's #8b6914 where white reaches
    // 5.09:1 and passes AA. The ghost variant below keeps #8b6914 as gold text on cream.
    return `<td align="center" bgcolor="#8b6914" style="background-color:#8b6914;border-radius:999px"><a href="${href}" style="display:block;padding:14px 28px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none">${label}</a></td>`
  }

  if (button.variant === 'outline') {
    return `<td align="center" style="border:2px solid #005131;border-radius:999px"><a href="${href}" style="display:block;padding:12px 26px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;line-height:20px;color:#005131;text-decoration:none">${label}</a></td>`
  }

  return `<td align="center" style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;line-height:20px"><a href="${href}" style="color:#8b6914;text-decoration:none">${label}</a></td>`
}

export const textBlock = defineBlock<TextBlockData>({
  type: 'text_block',
  fixture: 'lib_text_block.html',
  schema: textBlockSchema,
  sample: {
    heading: 'A plain heading and body block',
    body: [
      'The workhorse. Heading, one or two paragraphs, then an optional tick list underneath.',
    ],
    list_items: [
      'List rows are table rows, not bullets, so they hold up in Outlook',
      'Keep each one to a single line where you can',
    ],
    buttons: [
      { label: 'Primary', url: 'https://www.the-anchor.pub', variant: 'primary' },
      { label: 'Outline', url: 'https://www.the-anchor.pub', variant: 'outline' },
      { label: 'Ghost link →', url: 'https://www.the-anchor.pub', variant: 'ghost' },
    ],
  },
  render: (data) => {
    const rows: string[] = [
      `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#faf8f3"><tbody>`,
      `<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:32px 32px 0;font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:26px;line-height:32px;letter-spacing:-0.02em;color:#005131">${escapeEmailText(data.heading)}</td></tr>`,
    ]

    for (const paragraph of data.body ?? []) {
      rows.push(
        `<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:12px 32px 0;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:27px;color:#1a1a1a">${escapeEmailText(paragraph)}</td></tr>`,
      )
    }

    if (data.list_items?.length) {
      rows.push(
        `<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:16px 32px 0"><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse"><tbody>`,
      )
      for (const item of data.list_items) {
        rows.push(
          `<tr><td width="22" valign="top" style="width:22px;font-family:'Outfit',Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:#a57626">&#8226;</td><td style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:26px;color:#1a1a1a">${escapeEmailText(item)}</td></tr>`,
        )
      }
      rows.push(`</tbody></table></td></tr>`)
    }

    if (data.buttons?.length) {
      rows.push(
        `<tr><td bgcolor="#faf8f3" align="center" style="background-color:#faf8f3;padding:24px 32px 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 auto"><tbody><tr>`,
      )
      data.buttons.forEach((button, index) => {
        if (index > 0) {
          // A ghost link has no pill padding of its own, so it gets a slightly wider gap.
          const gap = button.variant === 'ghost' ? 14 : 12
          rows.push(`<td width="${gap}" style="width:${gap}px;font-size:0">&nbsp;</td>`)
        }
        rows.push(buttonCell(button))
      })
      rows.push(`</tr></tbody></table></td></tr>`)
    }

    rows.push(
      `<tr><td bgcolor="#faf8f3" align="center" style="background-color:#faf8f3;padding:30px 32px 32px"><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse"><tbody><tr><td height="1" style="height:1px;background-color:#e2dccf;font-size:0;line-height:0">&nbsp;</td></tr></tbody></table></td></tr>`,
    )
    rows.push(`</tbody></table>`)

    return rows.join('\n')
  },
  text: (data) => {
    const parts: string[] = [data.heading]

    for (const paragraph of data.body ?? []) parts.push(paragraph)
    if (data.list_items?.length) {
      parts.push(data.list_items.map((item) => `- ${item}`).join('\n'))
    }
    for (const button of data.buttons ?? []) {
      parts.push(`${button.label}: ${button.url}`)
    }

    return `${parts.join('\n\n')}\n`
  },
})
