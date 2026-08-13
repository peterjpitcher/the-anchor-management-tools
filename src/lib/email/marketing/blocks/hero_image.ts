import { z } from 'zod'

import { escapeEmailText, escapeEmailUrl } from '../escape'
import { defineBlock } from './types'

/**
 * The default opener: full-bleed photo, gold kicker, serif headline, one or two paragraphs
 * and a single primary button.
 *
 * Use this whenever there is a photograph worth leading with. If there is not, use
 * `hero_framed` instead. A weak photo is worse than no photo.
 *
 * The photograph is not hosted yet, so the handover ships the real image row commented out
 * above a sand-coloured placeholder row, and the placeholder is what renders. Both rows are
 * reproduced exactly as the designer wrote them. The `image` slot drives the commented row's
 * src, alt and dimensions, so the swap to the real photo is a matter of deleting the
 * placeholder row and uncommenting the one above it once the file is on a host. Until then
 * `placeholder_label` and `placeholder_caption` brief whoever is sourcing the shot.
 */

const heroImageImageSchema = z.object({
  src: z.string().min(1),
  alt: z.string().min(1).max(160),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

export const heroImageSchema = z.object({
  image: heroImageImageSchema,
  placeholder_label: z.string().min(1).max(80),
  placeholder_caption: z.string().min(1).max(80),
  kicker: z.string().min(1).max(60),
  headline: z.string().min(1).max(120),
  body: z.array(z.string().min(1).max(400)).min(1).max(2),
  cta_label: z.string().min(1).max(60),
  cta_url: z.string().min(1),
})

export type HeroImageData = z.infer<typeof heroImageSchema>

export const heroImage = defineBlock<HeroImageData>({
  type: 'hero_image',
  fixture: 'hero_image.html',
  schema: heroImageSchema,
  sample: {
    image: {
      src: 'https://YOUR-HOST/hero-christmas-table.jpg',
      alt: 'A table laid for Christmas dinner at The Anchor',
      width: 600,
      height: 340,
    },
    placeholder_label: 'Image slot 1 · 1200 × 680',
    placeholder_caption: 'Christmas table laid up',
    kicker: 'Christmas 2026 · bookings open',
    headline: 'Christmas at The Anchor is open for bookings',
    body: [
      'We serve Christmas dinner from 10 November to 20 December 2026. A village pub rather than a hotel function room, so your group gets its own table and its own evening. Never a shared sitting with strangers.',
      'Everyone picks their own courses, so nobody is tied to what the rest of the table is having.',
    ],
    cta_label: 'Start your Christmas booking',
    cta_url: 'https://www.the-anchor.pub/christmas-parties',
  },
  render: (data) => `
<!-- IMAGE SLOT: replace this whole row with the row below once the photo is hosted
<tr><td style="padding:0;font-size:0;line-height:0"><img src="${escapeEmailUrl(data.image.src)}" width="${data.image.width}" height="${data.image.height}" alt="${escapeEmailText(data.image.alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>
-->
<tr><td align="center" valign="middle" height="${data.image.height}" style="height:${data.image.height}px;background-color:#f5e6d3;border-bottom:1px solid #e2dccf;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;line-height:20px;letter-spacing:0.14em;text-transform:uppercase;color:#8b6914">${escapeEmailText(data.placeholder_label)}<br>${escapeEmailText(data.placeholder_caption)}</td></tr>

<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:40px 32px 8px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;line-height:16px;mso-line-height-rule:exactly;letter-spacing:0.18em;text-transform:uppercase;color:#8b6914">${escapeEmailText(data.kicker)}</td></tr>
<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:10px 32px 0;font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:38px;font-weight:400;line-height:44px;mso-line-height-rule:exactly;letter-spacing:-0.02em;color:#005131">${escapeEmailText(data.headline)}</td></tr>
${data.body
  .map(
    (paragraph, index) =>
      `<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:${index === 0 ? '16px' : '14px'} 32px 0;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:27px;mso-line-height-rule:exactly;color:#1a1a1a">${escapeEmailText(paragraph)}</td></tr>`,
  )
  .join('\n')}

<tr><td bgcolor="#faf8f3" align="left" style="background-color:#faf8f3;padding:26px 32px 34px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tbody><tr><td align="center" bgcolor="#a57626" style="background-color:#a57626;border-radius:999px"><a href="${escapeEmailUrl(data.cta_url)}" style="display:block;padding:15px 32px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;line-height:20px;color:#1a1a1a;text-decoration:none">${escapeEmailText(data.cta_label)}</a></td></tr></tbody></table>
</td></tr>
`,
  text: (data) =>
    `${data.kicker.toUpperCase()}\n\n${data.headline}\n\n${data.body.join('\n\n')}\n\n${data.cta_label}: ${data.cta_url}\n`,
})
