import { z } from 'zod'

import { escapeEmailText, escapeEmailUrl } from '../escape'
import { defineBlock, type EmailImage } from './types'

/**
 * One offer or one dish, in a white card with a gold top accent.
 *
 * Use it when a single thing deserves a picture and a paragraph of its own. Two of them
 * stacked reads as a list, so if there are two things to say, reach for `two_up_cards`.
 *
 * The image slot ships as the designer's placeholder panel, exactly as the handover draws
 * it, and takes a hosted photograph once there is one. Supply at 1072 x 460 and set the
 * render size (536 x 230) on the `EmailImage`, following the handover's own hero pattern.
 * `alt` is not optional: about a third of opens have images off.
 */

const featureCardImageSchema: z.ZodType<EmailImage> = z.object({
  src: z.string().min(1),
  alt: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

export const featureCardSchema = z.object({
  /** A hosted photograph, or null to keep the designer's placeholder panel. */
  image: featureCardImageSchema.nullable(),
  heading: z.string().min(1).max(120),
  body: z.string().min(1).max(400),
  link_label: z.string().min(1).max(80),
  link_url: z.string().min(1),
})

export type FeatureCardData = z.infer<typeof featureCardSchema>

function imageRow(image: EmailImage | null): string {
  if (!image) {
    return `<tr><td align="center" valign="middle" height="230" style="height:230px;background-color:#f5e6d3;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;line-height:20px;letter-spacing:0.14em;text-transform:uppercase;color:#8b6914">Image &middot; 1072 &times; 460</td></tr>`
  }

  return `<tr><td style="padding:0;font-size:0;line-height:0"><img src="${escapeEmailUrl(image.src)}" width="${image.width}" height="${image.height}" alt="${escapeEmailText(image.alt)}" style="display:block;width:100%;max-width:${image.width}px;height:auto;border:0"></td></tr>`
}

export const featureCard = defineBlock<FeatureCardData>({
  type: 'feature_card',
  fixture: 'lib_feature_card.html',
  schema: featureCardSchema,
  sample: {
    image: null,
    heading: 'Sunday roast, carved fresh to order',
    body: 'A card for one offer or one dish. Gold top-accent, photograph, short paragraph, one link out.',
    link_label: 'See the Sunday roast',
    link_url: 'https://www.the-anchor.pub/sunday-roast',
  },
  render: (data) =>
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#faf8f3"><tbody>
<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:32px"><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse;background-color:#ffffff;border-top:3px solid #a57626;border-right:1px solid #e2dccf;border-bottom:1px solid #e2dccf;border-left:1px solid #e2dccf"><tbody>
${imageRow(data.image)}
<tr><td style="padding:24px 24px 0;font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:26px;line-height:32px;letter-spacing:-0.02em;color:#005131">${escapeEmailText(data.heading)}</td></tr>
<tr><td style="padding:12px 24px 0;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:25px;color:#1a1a1a">${escapeEmailText(data.body)}</td></tr>
<tr><td style="padding:16px 24px 26px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;line-height:22px"><a href="${escapeEmailUrl(data.link_url)}" style="color:#8b6914;text-decoration:none">${escapeEmailText(data.link_label)} &rarr;</a></td></tr>
</tbody></table></td></tr>
</tbody></table>`,
  text: (data) => `${data.heading}\n${data.body}\n${data.link_label}: ${data.link_url}\n`,
})
