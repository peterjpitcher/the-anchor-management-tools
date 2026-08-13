import { z } from 'zod'

import { escapeEmailText } from '../escape'
import { defineBlock } from './types'

/**
 * Three cards with a gold top accent, each carrying a label, a price and a short note.
 *
 * Use it when the answer to "what does it cost" is a small set of options rather than one
 * number. The cards stack on mobile via the `stack` class in the shell's media query.
 *
 * The footnote row underneath is where the honest caveats go, the ones that would otherwise
 * turn into a complaint at the till.
 */

const priceTileSchema = z.object({
  label: z.string().min(1).max(40),
  price: z.string().min(1).max(20),
  note: z.string().min(1).max(40),
})

export const priceTilesSchema = z.object({
  tiles: z.array(priceTileSchema).length(3),
  footnote: z.string().min(1).max(400),
})

export type PriceTilesData = z.infer<typeof priceTilesSchema>

export const priceTiles = defineBlock<PriceTilesData>({
  type: 'price_tiles',
  fixture: 'price_tiles.html',
  schema: priceTilesSchema,
  sample: {
    tiles: [
      { label: '1 course', price: '£23', note: 'from, per person' },
      { label: '2 courses', price: '£33.95', note: 'from, per person' },
      { label: '3 courses', price: '£36.95', note: 'from, per person' },
    ],
    footnote:
      'Every adult gets a glass of prosecco, swappable for orange juice. Weekday and weekend prices differ, and pre-orders come to us 7 days before your date. Festive buffets are available for 30 guests or more.',
  },
  render: (data) => `
<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:34px 32px 0">
<table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse"><tbody><tr>
${data.tiles
  .map(
    (tile) =>
      `<td width="170" valign="top" bgcolor="#ffffff" class="stack" style="width:170px;background-color:#ffffff;border-top:3px solid #a57626;border-right:1px solid #e2dccf;border-bottom:1px solid #e2dccf;border-left:1px solid #e2dccf;padding:18px 16px" align="center"><div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;line-height:16px;letter-spacing:0.14em;text-transform:uppercase;color:#8b6914">${escapeEmailText(tile.label)}</div><div style="font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:30px;line-height:38px;color:#005131;padding-top:6px">${escapeEmailText(tile.price)}</div><div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#6f6a61">${escapeEmailText(tile.note)}</div></td>`,
  )
  .join('\n<td width="13" style="width:13px;font-size:0;line-height:0">&nbsp;</td>\n')}
</tr></tbody></table>
</td></tr>
<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:16px 32px 0;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:23px;mso-line-height-rule:exactly;color:#6f6a61">${escapeEmailText(data.footnote)}</td></tr>
<tr><td height="26" bgcolor="#faf8f3" style="height:26px;background-color:#faf8f3;font-size:0;line-height:0">&nbsp;</td></tr>
`,
  text: (data) =>
    `${data.tiles.map((tile) => `${tile.label}: ${tile.price} ${tile.note}`).join('\n')}\n\n${data.footnote}\n`,
})
