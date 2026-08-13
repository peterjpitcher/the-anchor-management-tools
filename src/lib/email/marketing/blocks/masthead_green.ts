import { z } from 'zod'

import { defineBlock } from './types'

/**
 * Default header: green band, white wordmark, kicker strip.
 *
 * No slots. The wordmark is never restyled, recoloured or stretched, so there is nothing
 * here for a campaign to vary.
 */

export const mastheadGreenSchema = z.object({})

export type MastheadGreenData = z.infer<typeof mastheadGreenSchema>

export const mastheadGreen = defineBlock<MastheadGreenData>({
  type: 'masthead_green',
  fixture: 'masthead_green.html',
  schema: mastheadGreenSchema,
  sample: {},
  render: () =>
    `<tr><td bgcolor="#005131" align="center" style="background-color:#005131;padding:28px 32px 22px"><img src="https://www.the-anchor.pub/images/branding/the-anchor-pub-logo-white-transparent.png" width="176" height="88" alt="The Anchor, Stanwell Moor Village" style="display:block;width:176px;height:88px;border:0;margin:0 auto"></td></tr>
<tr><td bgcolor="#003d25" align="center" style="background-color:#003d25;padding:10px 32px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;line-height:16px;mso-line-height-rule:exactly;letter-spacing:0.18em;text-transform:uppercase;color:#c9a020">Stanwell Moor Village &middot; Since 1751</td></tr>
`,
  text: () => 'THE ANCHOR\nStanwell Moor Village, since 1751\n',
})
