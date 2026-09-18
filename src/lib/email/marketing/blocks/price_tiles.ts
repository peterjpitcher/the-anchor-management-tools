import { z } from 'zod'

import { GUEST } from '@/lib/brand/palette'

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
<tr><td bgcolor="${GUEST.cream}" class="gutter" style="background-color:${GUEST.cream};padding:34px 32px 0">
<table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse"><tbody><tr>
${data.tiles
  .map(
    (tile) =>
      `<td width="170" valign="top" bgcolor="${GUEST.surface}" class="stack" style="width:170px;background-color:${GUEST.surface};border-top:3px solid ${GUEST.gold};border-right:1px solid ${GUEST.border};border-bottom:1px solid ${GUEST.border};border-left:1px solid ${GUEST.border};padding:18px 16px" align="center"><div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;line-height:16px;letter-spacing:0.14em;text-transform:uppercase;color:${GUEST.accentText}">${escapeEmailText(tile.label)}</div><div style="font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:30px;line-height:38px;color:${GUEST.green};padding-top:6px">${escapeEmailText(tile.price)}</div><div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:${GUEST.textMuted}">${escapeEmailText(tile.note)}</div></td>`,
  )
  .join('\n<td width="13" style="width:13px;font-size:0;line-height:0">&nbsp;</td>\n')}
</tr></tbody></table>
</td></tr>
<tr><td bgcolor="${GUEST.cream}" class="gutter" style="background-color:${GUEST.cream};padding:16px 32px 0;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:23px;mso-line-height-rule:exactly;color:${GUEST.textMuted}">${escapeEmailText(data.footnote)}</td></tr>
<tr><td height="26" bgcolor="${GUEST.cream}" style="height:26px;background-color:${GUEST.cream};font-size:0;line-height:0">&nbsp;</td></tr>
`,
  text: (data) =>
    `${data.tiles.map((tile) => `${tile.label}: ${tile.price} ${tile.note}`).join('\n')}\n\n${data.footnote}\n`,
})
