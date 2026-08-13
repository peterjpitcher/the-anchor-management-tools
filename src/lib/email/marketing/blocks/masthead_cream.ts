import { z } from 'zod'

import { defineBlock } from './types'

/**
 * Alternative header: white band, black wordmark, 4px gold top rule.
 *
 * For lighter, less promotional sends. No slots, because the wordmark is never restyled,
 * recoloured or stretched and the kicker is a fixed statement of who we are.
 */

export const mastheadCreamSchema = z.object({})

export type MastheadCreamData = z.infer<typeof mastheadCreamSchema>

export const mastheadCream = defineBlock<MastheadCreamData>({
  type: 'masthead_cream',
  fixture: 'lib_masthead_cream.html',
  schema: mastheadCreamSchema,
  sample: {},
  render: () =>
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#ffffff"><tbody>
<tr><td align="center" bgcolor="#ffffff" style="background-color:#ffffff;padding:28px 32px 20px;border-top:4px solid #a57626"><img src="https://www.the-anchor.pub/images/branding/the-anchor-pub-logo-black-transparent.png" width="176" height="88" alt="The Anchor, Stanwell Moor Village" style="display:block;width:176px;height:88px;border:0;margin:0 auto"></td></tr>
<tr><td align="center" bgcolor="#ffffff" style="background-color:#ffffff;padding:0 32px 22px;border-bottom:1px solid #e2dccf;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;line-height:16px;letter-spacing:0.18em;text-transform:uppercase;color:#8b6914">Stanwell Moor Village &middot; Since 1751</td></tr>
</tbody></table>`,
  text: () => 'THE ANCHOR\nStanwell Moor Village, since 1751\n',
})
