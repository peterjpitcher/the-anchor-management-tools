import { z } from 'zod'

import { GUEST } from '@/lib/brand/palette'

import { escapeEmailText } from '../escape'
import { defineBlock } from './types'

/**
 * Voucher-shaped panel with a dashed gold border, for something genuinely included.
 *
 * Always fill in the terms line. It is small and quiet on purpose, and it is what stops an
 * argument at the till when a guest arrives expecting something we did not promise.
 */

export const offerPanelSchema = z.object({
  kicker: z.string().min(1).max(60),
  headline: z.string().min(1).max(100),
  body: z.string().min(1).max(240),
  terms: z.string().min(1).max(200),
})

export type OfferPanelData = z.infer<typeof offerPanelSchema>

export const offerPanel = defineBlock<OfferPanelData>({
  type: 'offer_panel',
  fixture: 'lib_offer_panel.html',
  schema: offerPanelSchema,
  sample: {
    kicker: 'Included with every booking',
    headline: 'A glass of prosecco for every adult',
    body: 'Whichever courses they choose. Swappable for orange juice.',
    terms: 'Terms line goes here, small and honest.',
  },
  render: (data) =>
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:${GUEST.cream}"><tbody>
<tr><td bgcolor="${GUEST.cream}" class="gutter" style="background-color:${GUEST.cream};padding:32px"><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse;background-color:${GUEST.surface};border:2px dashed ${GUEST.gold}"><tbody>
<tr><td align="center" style="padding:28px 34px 0;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;line-height:16px;letter-spacing:0.18em;text-transform:uppercase;color:${GUEST.accentText}">${escapeEmailText(data.kicker)}</td></tr>
<tr><td align="center" style="padding:10px 34px 0;font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:28px;line-height:34px;letter-spacing:-0.02em;color:${GUEST.green}">${escapeEmailText(data.headline)}</td></tr>
<tr><td align="center" style="padding:10px 34px 0;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:${GUEST.text}">${escapeEmailText(data.body)}</td></tr>
<tr><td align="center" style="padding:14px 34px 26px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;line-height:19px;color:${GUEST.textMuted}">${escapeEmailText(data.terms)}</td></tr>
</tbody></table></td></tr>
</tbody></table>`,
  text: (data) => `${data.kicker}\n${data.headline}\n${data.body}\n${data.terms}\n`,
})
