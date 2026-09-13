import { z } from 'zod'

import { escapeEmailText, escapeEmailUrl } from '../escape'
import { defineBlock } from './types'

/**
 * The monthly round-up's header: the green band with that month's foliage around the wordmark.
 *
 * `masthead_green` stays the default for every event email. This one exists so the monthly
 * round-up looks like the monthly round-up: twelve pieces of artwork, one per month, drawn to
 * the same 3:1 band. Published to storage by
 * `scripts/one-off/publish-seasonal-mastheads.ts`; the originals are in
 * `docs/design/email-seasonal/`.
 *
 * This block is ours rather than the designer's, so its fixture is generated from
 * `render(sample)` and committed. There is no design decision in here to get wrong: the outer
 * cell reuses `masthead_green`'s own `#005131`, and the image is the standard full-bleed
 * treatment. Everything that used to be markup, the wordmark and the "Stanwell Moor Village"
 * kicker strip, is baked into the artwork.
 *
 * WHICH IS WHY THE ALT TEXT IS LOAD-BEARING. The whole header is now one image, so with
 * images off a reader would otherwise see an email that opens with nothing, which is what
 * spam looks like. The alt text has to say who this is from, and the schema will not accept a
 * short one. The cell also carries the brand green as its background, so the band is the
 * right colour while the image loads and if it never does.
 */

/** The band is 3:1. The attributes are what Outlook obeys, so they are not the caller's. */
const IMAGE_WIDTH = 600
const IMAGE_HEIGHT = 200

export const mastheadSeasonalSchema = z.object({
  /** Absolute https URL of that month's band, 1200 x 400, JPEG. */
  image_url: z.string().min(1),
  /**
   * Long enough to name the pub, because this replaces every word in the header.
   *
   * "The Anchor, Stanwell Moor Village, since 1751. October foliage around the wordmark."
   */
  alt: z.string().min(40).max(200),
})

export type MastheadSeasonalData = z.infer<typeof mastheadSeasonalSchema>

export const mastheadSeasonal = defineBlock<MastheadSeasonalData>({
  type: 'masthead_seasonal',
  fixture: 'masthead_seasonal.html',
  schema: mastheadSeasonalSchema,
  sample: {
    image_url:
      'https://tfcasgxopxegwrabvwat.supabase.co/storage/v1/object/public/event-images/marketing/seasonal-masthead/10-october.jpg',
    alt: 'The Anchor, Stanwell Moor Village, since 1751. Autumn leaves and berries around the wordmark.',
  },
  render: (data) =>
    `<tr><td bgcolor="#005131" align="center" style="background-color:#005131;padding:0;font-size:0;line-height:0"><img src="${escapeEmailUrl(data.image_url)}" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" alt="${escapeEmailText(data.alt)}" style="display:block;width:100%;max-width:${IMAGE_WIDTH}px;height:auto;border:0"></td></tr>
`,
  text: () => 'THE ANCHOR\nStanwell Moor Village, since 1751\n',
})
