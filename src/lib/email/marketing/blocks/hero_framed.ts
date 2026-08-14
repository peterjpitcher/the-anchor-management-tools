import { z } from 'zod'

import { escapeEmailText, escapeEmailUrl } from '../escape'
import { defineBlock } from './types'

/**
 * Opening panel for sends with no photograph: deep green field, inset gold rule-frame.
 *
 * Use this when there is no good image. A weak photograph costs more trust than it buys,
 * so the frame carries the opening instead.
 *
 * Colour deviation from the handover. The owner asked for white text on every gold fill.
 * White on the designer's button gold #c9a020 measures 2.46:1 and fails, so the button fill
 * darkens to the palette's #8b6914 where white reaches 5.09:1 and passes AA. The kicker and
 * the rule-frame keep #c9a020: they are gold ON the deep green field, not text on gold.
 */

export const heroFramedSchema = z.object({
  kicker: z.string().min(1).max(60),
  headline: z.string().min(1).max(120),
  body: z.string().min(1).max(300),
  cta_label: z.string().min(1).max(40),
  cta_url: z.string().min(1),
})

export type HeroFramedData = z.infer<typeof heroFramedSchema>

export const heroFramed = defineBlock<HeroFramedData>({
  type: 'hero_framed',
  fixture: 'lib_hero_framed.html',
  schema: heroFramedSchema,
  sample: {
    kicker: 'Table booking',
    headline: 'A headline that carries the whole email',
    body: 'For sends with no photograph. The gold rule-frame does the work instead.',
    cta_label: 'Book a table',
    cta_url: 'https://www.the-anchor.pub/book-table',
  },
  render: (data) =>
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#0c1d11"><tbody>
<tr><td bgcolor="#0c1d11" style="background-color:#0c1d11;padding:26px"><table role="presentation" width="548" cellpadding="0" cellspacing="0" border="0" style="width:548px;border-collapse:collapse;border:1px solid rgba(201,160,32,0.55)"><tbody>
<tr><td align="center" style="padding:44px 34px 40px">
<div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;line-height:16px;letter-spacing:0.18em;text-transform:uppercase;color:#c9a020;padding-bottom:14px">${escapeEmailText(data.kicker)}</div>
<div style="font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:36px;line-height:42px;letter-spacing:-0.02em;color:#f0e6c6;padding-bottom:14px">${escapeEmailText(data.headline)}</div>
<div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:#f0e6c6;padding-bottom:24px">${escapeEmailText(data.body)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 auto"><tbody><tr><td align="center" bgcolor="#8b6914" style="background-color:#8b6914;border-radius:999px"><a href="${escapeEmailUrl(data.cta_url)}" style="display:block;padding:14px 30px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none">${escapeEmailText(data.cta_label)}</a></td></tr></tbody></table>
</td></tr></tbody></table></td></tr>
</tbody></table>`,
  text: (data) =>
    `${data.kicker}\n\n${data.headline}\n\n${data.body}\n\n${data.cta_label}: ${data.cta_url}\n`,
})
