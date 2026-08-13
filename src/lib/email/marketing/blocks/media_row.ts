import { z } from 'zod'

import { escapeEmailText, escapeEmailUrl } from '../escape'
import { defineBlock, type EmailImage } from './types'

/**
 * A 240px image beside a short piece of copy and one link.
 *
 * Swap the two cells to put the image on the right, and alternate the sides down a long
 * email. Both cells carry `class="stack"`, so they sit one above the other on a phone.
 *
 * The designer's handover ships this block with a tinted image placeholder rather than a
 * photograph, so an empty `src` keeps that placeholder and a real `src` renders the
 * photograph in its place. Always write the alt text either way: about a third of opens
 * have images off.
 */

const mediaRowImageSchema: z.ZodType<EmailImage> = z.object({
  /** Empty keeps the designer's placeholder. Otherwise an absolute https URL. */
  src: z.string(),
  alt: z.string().min(1).max(160),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

export const mediaRowSchema = z.object({
  image: mediaRowImageSchema,
  heading: z.string().min(1).max(120),
  body: z.string().min(1).max(400),
  link_label: z.string().min(1).max(60),
  link_url: z.string().min(1),
})

export type MediaRowData = z.infer<typeof mediaRowSchema>

function imageCell(image: EmailImage): string {
  if (image.src) {
    return `<td width="240" valign="top" class="stack" style="width:240px;font-size:0;line-height:0"><img src="${escapeEmailUrl(image.src)}" width="240" height="200" alt="${escapeEmailText(image.alt)}" style="display:block;width:100%;max-width:240px;height:auto;border:0"></td>`
  }

  return `<td width="240" valign="top" align="center" height="200" bgcolor="#f5e6d3" class="stack" style="width:240px;height:200px;background-color:#f5e6d3;border:1px solid #e2dccf;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;line-height:18px;letter-spacing:0.12em;text-transform:uppercase;color:#8b6914"><span style="display:inline-block;padding-top:88px">Image &middot; ${image.width} &times; ${image.height}</span></td>`
}

export const mediaRow = defineBlock<MediaRowData>({
  type: 'media_row',
  fixture: 'lib_media_row.html',
  schema: mediaRowSchema,
  sample: {
    image: {
      src: '',
      alt: 'The bar at The Anchor on a quiet afternoon',
      width: 480,
      height: 400,
    },
    heading: 'Photo beside the point it proves',
    body: 'Three lines of copy at most, then one link. Flip the two cells to put the image on the right.',
    link_label: 'Have a look around →',
    link_url: 'https://www.the-anchor.pub/our-pub',
  },
  render: (data) =>
    [
      `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#faf8f3"><tbody>`,
      `<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:32px"><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse"><tbody><tr>`,
      imageCell(data.image),
      `<td width="24" style="width:24px;font-size:0;line-height:0">&nbsp;</td>`,
      `<td valign="middle" class="stack" style="padding:0"><div style="font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:22px;line-height:28px;letter-spacing:-0.02em;color:#005131;padding-bottom:8px">${escapeEmailText(data.heading)}</div><div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:23px;color:#1a1a1a;padding-bottom:12px">${escapeEmailText(data.body)}</div><div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;line-height:20px"><a href="${escapeEmailUrl(data.link_url)}" style="color:#8b6914;text-decoration:none">${escapeEmailText(data.link_label)}</a></div></td>`,
      `</tr></tbody></table></td></tr>`,
      `</tbody></table>`,
    ].join('\n'),
  text: (data) => {
    // Only describe the photograph when there is one to describe.
    const image = data.image.src ? `[Image: ${data.image.alt}]\n\n` : ''

    return `${image}${data.heading}\n\n${data.body}\n\n${data.link_label}: ${data.link_url}\n`
  },
})
