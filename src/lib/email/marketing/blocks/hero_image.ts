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
 *
 * Colour deviation from the handover. The owner asked for white text on every gold fill.
 * White on the designer's button gold #a57626 measures 4.02:1, which only clears AA for large
 * text, so the button fill darkens to the palette's #8b6914 where white reaches 5.09:1 and
 * passes AA. The kicker and the placeholder caption keep #8b6914 as gold text on cream, which
 * is what that value was already in the palette for.
 */

const heroImageImageSchema = z.object({
  /** Empty means no photo yet, and the designer's placeholder panel renders instead. */
  src: z.string(),
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


/**
 * The photo, or the designer's placeholder panel when there is no photo yet.
 *
 * The handover ships the real <img> row commented out above a sand placeholder, because the
 * photographs were not hosted when it was drawn. Reproducing that literally meant a supplied
 * photo was silently ignored and every send carried the placeholder, so the switch is now on
 * whether a URL is actually present. An empty src still reproduces the handover file exactly,
 * which is what the fidelity test pins.
 */
function imageRow(data: HeroImageData): string {
  if (data.image.src.trim()) {
    return `<tr><td style="padding:0;font-size:0;line-height:0"><img src="${escapeEmailUrl(data.image.src)}" width="${data.image.width}" height="${data.image.height}" alt="${escapeEmailText(data.image.alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>`
  }

  return `<!-- IMAGE SLOT: replace this whole row with the row below once the photo is hosted
<tr><td style="padding:0;font-size:0;line-height:0"><img src="https://YOUR-HOST/hero-christmas-table.jpg" width="${data.image.width}" height="${data.image.height}" alt="${escapeEmailText(data.image.alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>
-->
<tr><td align="center" valign="middle" height="${data.image.height}" style="height:${data.image.height}px;background-color:#f5e6d3;border-bottom:1px solid #e2dccf;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;line-height:20px;letter-spacing:0.14em;text-transform:uppercase;color:#8b6914">${escapeEmailText(data.placeholder_label)}<br>${escapeEmailText(data.placeholder_caption)}</td></tr>`
}

export const heroImage = defineBlock<HeroImageData>({
  type: 'hero_image',
  fixture: 'hero_image.html',
  schema: heroImageSchema,
  sample: {
    image: {
      // Empty on purpose: this sample is what the fidelity test compares against the handover
      // file, and the handover shipped the placeholder because the photo was not hosted yet.
      src: '',
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
${imageRow(data)}

<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:40px 32px 8px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;line-height:16px;mso-line-height-rule:exactly;letter-spacing:0.18em;text-transform:uppercase;color:#8b6914">${escapeEmailText(data.kicker)}</td></tr>
<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:10px 32px 0;font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:38px;font-weight:400;line-height:44px;mso-line-height-rule:exactly;letter-spacing:-0.02em;color:#005131">${escapeEmailText(data.headline)}</td></tr>
${data.body
  .map(
    (paragraph, index) =>
      `<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:${index === 0 ? '16px' : '14px'} 32px 0;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:27px;mso-line-height-rule:exactly;color:#1a1a1a">${escapeEmailText(paragraph)}</td></tr>`,
  )
  .join('\n')}

<tr><td bgcolor="#faf8f3" align="center" style="background-color:#faf8f3;padding:26px 32px 34px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tbody><tr><td align="center" bgcolor="#8b6914" style="background-color:#8b6914;border-radius:999px"><a href="${escapeEmailUrl(data.cta_url)}" style="display:block;padding:15px 32px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none">${escapeEmailText(data.cta_label)}</a></td></tr></tbody></table>
</td></tr>
`,
  text: (data) =>
    `${data.kicker.toUpperCase()}\n\n${data.headline}\n\n${data.body.join('\n\n')}\n\n${data.cta_label}: ${data.cta_url}\n`,
})
