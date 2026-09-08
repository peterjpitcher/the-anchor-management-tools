import { z } from 'zod'

import { escapeEmailText, escapeEmailUrl } from '../escape'
import { defineBlock, type EmailImage } from './types'

/**
 * A 240px image beside a short piece of copy and one link.
 *
 * Swap the two cells to put the image on the right, and alternate the sides down a long
 * email. Every cell carries `class="stack"`, the gutter included, so on a phone the picture
 * sits above the copy with a 16px gap rather than the two butting together.
 *
 * Redrawn in September 2026. The first version hardcoded `height="200"` on the image, so
 * every photograph was declared 240 x 200 whatever shape it actually was, and clients that
 * trust the attributes drew it squashed. The caller now sets both, 240 wide and the height
 * from the artwork's own ratio: 240 x 240 for a square poster, 240 x 135 for 16:9,
 * 240 x 103 for a 2.33:1 band. The image is also a link now, to the same place as the text
 * link under it, because a reader who taps a picture has asked the same question.
 *
 * `width` is pinned rather than defaulted: the markup carries `width:240px` in its own
 * style, so an attribute that disagreed would draw at one size and reserve space at another.
 */

/** The slot width the markup is drawn to. The style attribute repeats it. */
const IMAGE_WIDTH = 240

/**
 * The designer's local placeholder, kept for a row with no photograph yet.
 *
 * Same contract as `image_full`: an empty `src` reproduces the handover byte for byte, a
 * real URL renders the photograph in its place. The path is relative, so it cannot resolve
 * in an inbox. That is deliberate. It proves the fixture, it does not ship.
 */
const PLACEHOLDER_SRC = 'img/slot-16x9.png'

const mediaRowImageSchema: z.ZodType<EmailImage> = z.object({
  /** Empty keeps the designer's placeholder. Otherwise an absolute https URL. */
  src: z.string(),
  alt: z.string().min(1).max(160),
  width: z.literal(IMAGE_WIDTH),
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

const SANS = "'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif"
const SERIF = "'DM Serif Display',Georgia,'Times New Roman',serif"

export const mediaRow = defineBlock<MediaRowData>({
  type: 'media_row',
  fixture: 'lib_media_row.html',
  schema: mediaRowSchema,
  sample: {
    image: {
      src: '',
      alt: 'The bar at The Anchor',
      width: 240,
      height: 135,
    },
    heading: 'Photo beside the point it proves',
    body: 'Three lines of copy at most, then one link. The caller sets the image width and height to the artwork’s own ratio, 240 wide.',
    link_label: 'Have a look around →',
    link_url: 'https://www.the-anchor.pub/our-pub',
  },
  render: (data) => {
    const href = escapeEmailUrl(data.link_url)
    const src = data.image.src.trim() ? escapeEmailUrl(data.image.src) : PLACEHOLDER_SRC

    return [
      `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#faf8f3"><tbody>`,
      `<tr><td bgcolor="#faf8f3" class="gutter" style="background-color:#faf8f3;padding:32px;"><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse"><tbody>`,
      `<tr>`,
      `<td width="240" valign="top" class="stack" style="width:240px;padding:0"><a href="${href}" style="text-decoration:none"><img src="${src}" width="${data.image.width}" height="${data.image.height}" alt="${escapeEmailText(data.image.alt)}" style="display:block;width:100%;max-width:100%;height:auto;border:1px solid #e2dccf"></a></td>`,
      `<td width="24" class="stack" style="width:24px;font-size:0;line-height:0;height:16px">&nbsp;</td>`,
      `<td valign="middle" class="stack" style="padding:0"><div style="font-family:${SERIF};font-size:22px;line-height:28px;letter-spacing:-0.02em;color:#005131;padding-bottom:8px">${escapeEmailText(data.heading)}</div><div style="font-family:${SANS};font-size:14px;line-height:23px;color:#1a1a1a;padding-bottom:12px">${escapeEmailText(data.body)}</div><div style="font-family:${SANS};font-size:14px;font-weight:600;line-height:20px"><a href="${href}" style="color:#8b6914;text-decoration:none">${escapeEmailText(data.link_label)}</a></div></td>`,
      `</tr>`,
      `</tbody></table></td></tr>`,
      `</tbody></table>`,
    ].join('\n')
  },
  text: (data) => {
    // Only describe the photograph when there is one to describe.
    const image = data.image.src ? `[Image: ${data.image.alt}]\n\n` : ''

    return `${image}${data.heading}\n\n${data.body}\n\n${data.link_label}: ${data.link_url}\n`
  },
})
