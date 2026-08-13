import { z } from 'zod'

import { escapeEmailText, escapeEmailUrl } from '../escape'
import { defineBlock } from './types'

/**
 * The dark closing panel: script line, short ask, gold button, ticks, phone and WhatsApp.
 *
 * The last thing a long email says. It repeats the email's one action rather than
 * introducing a competing one, then puts the reassurance ticks directly under the button
 * where the hesitation actually happens, and finally offers a human alternative for people
 * who would rather ring or message than fill anything in.
 *
 * The button uses the gold-on-dark fill (#c9a020) with charcoal text, because white on gold
 * fails contrast.
 */

const LINK_STYLE = 'color:#c9a020;text-decoration:none;font-weight:600'

export const closingPanelDarkSchema = z.object({
  script_line: z.string().min(1).max(60),
  body: z.string().min(1).max(240),
  cta_label: z.string().min(1).max(60),
  cta_url: z.string().min(1).max(2048),
  reassurance_items: z.array(z.string().min(1).max(60)).min(1).max(3),
  phone_label: z.string().min(1).max(40),
  phone_url: z.string().min(1).max(60),
  whatsapp_label: z.string().min(1).max(40),
  whatsapp_url: z.string().min(1).max(2048),
})

export type ClosingPanelDarkData = z.infer<typeof closingPanelDarkSchema>

export const closingPanelDark = defineBlock<ClosingPanelDarkData>({
  type: 'closing_panel_dark',
  fixture: 'closing_panel_dark.html',
  schema: closingPanelDarkSchema,
  sample: {
    script_line: 'Talk to us',
    body: 'Tell us your date and rough numbers and we will come back to you within 24 hours.',
    cta_label: 'Send an enquiry',
    cta_url: 'https://www.the-anchor.pub/christmas-parties#enquiry',
    reassurance_items: ['No commitment, just a conversation', 'We reply within 24 hours'],
    phone_label: '01753 682707',
    phone_url: 'tel:+441753682707',
    whatsapp_label: 'WhatsApp',
    whatsapp_url: 'https://wa.me/441753682707',
  },
  render: (data) => {
    const reassurance = data.reassurance_items
      .map(
        (item) =>
          `<span style="color:#c9a020">&#10003;</span>&nbsp; ${escapeEmailText(item)}`,
      )
      .join(' &nbsp;&nbsp;')

    return `
<tr><td bgcolor="#0c1d11" style="background-color:#0c1d11;padding:38px 32px 34px" align="center">
<div style="font-family:'Clicker Script','Segoe Script','Brush Script MT',cursive;font-size:32px;line-height:38px;color:#c9a020;padding-bottom:6px">${escapeEmailText(data.script_line)}</div>
<div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:#f0e6c6;padding-bottom:22px">${escapeEmailText(data.body)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 auto"><tbody><tr><td align="center" bgcolor="#c9a020" style="background-color:#c9a020;border-radius:999px"><a href="${escapeEmailUrl(data.cta_url)}" style="display:block;padding:15px 34px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;line-height:20px;color:#1a1a1a;text-decoration:none">${escapeEmailText(data.cta_label)}</a></td></tr></tbody></table>
<div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;line-height:21px;color:#7a8b7f;padding-top:14px">${reassurance}</div>
<div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#f0e6c6;padding-top:22px">Or call <a href="${escapeEmailUrl(data.phone_url)}" style="${LINK_STYLE}">${escapeEmailText(data.phone_label)}</a>, or send us a <a href="${escapeEmailUrl(data.whatsapp_url)}" style="${LINK_STYLE}">${escapeEmailText(data.whatsapp_label)}</a> on the same number</div>
</td></tr>
`
  },
  text: (data) =>
    `${data.script_line}\n\n${data.body}\n\n${data.cta_label}: ${data.cta_url}\n\n${data.reassurance_items
      .map((item) => `- ${item}`)
      .join('\n')}\n\nOr call ${data.phone_label}, or send us a ${data.whatsapp_label} on the same number: ${data.whatsapp_url}\n`,
})
