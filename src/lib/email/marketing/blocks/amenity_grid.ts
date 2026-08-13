import { z } from 'zod'

import { escapeEmailText } from '../escape'
import { defineBlock } from './types'

/**
 * Two-column strip of practical facts on the sunk cream background.
 *
 * The quiet reassurance block: distances, parking, the ULEZ boundary. Each item leads with
 * a short gold highlight so the number is what the eye lands on, and the rest of the line
 * explains it. Columns carry `class="stack"` so they become full width on narrow screens.
 * Best used low in the email, once the reader is interested and is working out whether
 * getting here is easy.
 */

export const amenityGridSchema = z.object({
  items: z
    .array(
      z.object({
        highlight: z.string().min(1).max(40),
        text: z.string().min(1).max(80),
      }),
    )
    .min(1)
    .max(8),
})

export type AmenityGridData = z.infer<typeof amenityGridSchema>

const CELL_FONT =
  "font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:21px;color:#1a1a1a"

function renderCell(
  item: AmenityGridData['items'][number],
  column: number,
  bottomPadding: string,
): string {
  const padding = column === 0 ? `0 8px ${bottomPadding} 0` : `0 0 ${bottomPadding} 8px`
  return `<td width="260" valign="top" class="stack" style="width:260px;padding:${padding};${CELL_FONT}"><span style="color:#8b6914;font-weight:600">${escapeEmailText(item.highlight)}</span> ${escapeEmailText(item.text)}</td>`
}

export const amenityGrid = defineBlock<AmenityGridData>({
  type: 'amenity_grid',
  fixture: 'amenity_grid.html',
  schema: amenityGridSchema,
  sample: {
    items: [
      { highlight: '7 minutes', text: 'from Heathrow Terminal 5' },
      { highlight: '8 minutes', text: 'from Staines-upon-Thames' },
      { highlight: 'Around 20', text: 'free parking spaces on site' },
      { highlight: 'Outside', text: 'the ULEZ boundary' },
    ],
  },
  render: (data) => {
    const pairs: AmenityGridData['items'][] = []
    for (let index = 0; index < data.items.length; index += 2) {
      pairs.push(data.items.slice(index, index + 2))
    }

    const rows = pairs
      .map((pair, pairIndex) => {
        const bottomPadding = pairIndex === pairs.length - 1 ? '0' : '14px'
        const cells = pair.map((item, column) => renderCell(item, column, bottomPadding)).join('')
        return `<tr>${cells}</tr>`
      })
      .join('\n')

    return `
<tr><td bgcolor="#f2ede3" style="background-color:#f2ede3;border-top:1px solid #e2dccf;padding:26px 32px">
<table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse"><tbody>
${rows}
</tbody></table>
</td></tr>
`
  },
  text: (data) => `${data.items.map((item) => `${item.highlight} ${item.text}`).join('\n')}\n`,
})
