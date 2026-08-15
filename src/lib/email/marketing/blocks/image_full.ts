import { z } from 'zod'

import { escapeEmailText, escapeEmailUrl } from '../escape'
import { defineBlock } from './types'

/**
 * Full-bleed photograph on its own row, ruled off top and bottom.
 *
 * Use it to break up a long email or to open a second subject with a picture rather than
 * words. It carries no copy of its own, so pair it with `section_intro` above or below.
 *
 * The photograph is not hosted yet, so the handover ships the real image row commented out
 * above a sand-coloured placeholder row, and the placeholder is what renders. Both rows are
 * reproduced exactly as the designer wrote them. The `image` slot drives the commented row's
 * src, alt and dimensions, so the swap to the real photo is a matter of deleting the
 * placeholder row and uncommenting the one above it once the file is on a host. Until then
 * `placeholder_label` and `placeholder_caption` brief whoever is sourcing the shot.
 */

const imageFullImageSchema = z.object({
  /** Empty means no photo yet, and the designer's placeholder panel renders instead. */
  src: z.string(),
  alt: z.string().min(1).max(160),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

export const imageFullSchema = z.object({
  image: imageFullImageSchema,
  placeholder_label: z.string().min(1).max(80),
  placeholder_caption: z.string().min(1).max(80),
})

export type ImageFullData = z.infer<typeof imageFullSchema>


/**
 * The photo, or the designer's placeholder band when there is no photo yet.
 *
 * The handover ships the real <img> row commented out, because the photographs were not
 * hosted when it was drawn. Reproducing that literally meant a supplied photo was silently
 * ignored, so the switch is now on whether a URL is present. An empty src still reproduces
 * the handover file exactly, which is what the fidelity test pins.
 */
function imageRow(data: ImageFullData): string {
  if (data.image.src.trim()) {
    return `<tr><td style="padding:0;font-size:0;line-height:0"><img src="${escapeEmailUrl(data.image.src)}" width="${data.image.width}" height="${data.image.height}" alt="${escapeEmailText(data.image.alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>`
  }

  return `<!-- IMAGE SLOT: replace this whole row with the row below once the photo is hosted
<tr><td style="padding:0;font-size:0;line-height:0"><img src="https://YOUR-HOST/lunch-daytime.jpg" width="${data.image.width}" height="${data.image.height}" alt="${escapeEmailText(data.image.alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>
-->
<tr><td align="center" valign="middle" height="${data.image.height}" style="height:${data.image.height}px;background-color:#f5e6d3;border-top:1px solid #e2dccf;border-bottom:1px solid #e2dccf;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;line-height:20px;letter-spacing:0.14em;text-transform:uppercase;color:#8b6914">${escapeEmailText(data.placeholder_label)}<br>${escapeEmailText(data.placeholder_caption)}</td></tr>`
}

export const imageFull = defineBlock<ImageFullData>({
  type: 'image_full',
  fixture: 'image_full.html',
  schema: imageFullSchema,
  sample: {
    image: {
      // Empty on purpose: the fidelity test compares this sample to the handover file,
      // which shipped the placeholder because the photo was not hosted yet.
      src: '',
      alt: 'Lunch served at The Anchor near Heathrow',
      width: 600,
      height: 260,
    },
    placeholder_label: 'Image slot 2 · 1200 × 520',
    placeholder_caption: 'Daytime lunch on the table',
  },
  render: (data) => `
${imageRow(data)}
`,
  text: (data) => `${data.image.alt}\n`,
})
