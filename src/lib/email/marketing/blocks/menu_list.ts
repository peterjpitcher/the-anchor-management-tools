import { z } from 'zod'

import { escapeEmailText } from '../escape'
import { defineBlock } from './types'

/**
 * A short menu: dish name and price on one baseline, description underneath.
 *
 * Prices are free text so a dish can show a long dash where it is priced inside a set menu
 * rather than on its own. The optional tag carries a dietary note such as VEGAN or NGCI.
 * The last item drops its hairline and its bottom padding, which is why the rows are built
 * from the index rather than one repeated string.
 */

/** Long dash, written by code point so this file stays free of the character itself. */
const LONG_DASH = String.fromCodePoint(0x2014)

export const menuListSchema = z.object({
  heading: z.string().min(1).max(120),
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        price: z.string().min(1).max(20),
        description: z.string().min(1).max(300),
        tag: z.string().min(1).max(20).optional(),
      }),
    )
    .min(1)
    .max(12),
})

export type MenuListData = z.infer<typeof menuListSchema>

export const menuList = defineBlock<MenuListData>({
  type: 'menu_list',
  fixture: 'lib_menu_list.html',
  schema: menuListSchema,
  sample: {
    heading: 'On the menu',
    items: [
      {
        name: 'Christmas dinner, turkey',
        price: '£23',
        description:
          'All the trimmings: pigs in blankets, stuffing, sprouts, Yorkshire pudding, roasties and gravy.',
      },
      {
        name: 'Christmas dinner, pork',
        price: '£24',
        description: 'Same trimmings, served with a glass of prosecco, swappable for orange juice.',
      },
      {
        name: 'Vegetable wellington',
        price: LONG_DASH,
        description: 'Fully vegan trimmings and vegan gravy.',
        tag: 'VEGAN',
      },
    ],
  },
  render: (data) => {
    const rows: string[] = [
      `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#faf8f3"><tbody>`,
      `<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:32px 32px 6px;font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:26px;line-height:32px;letter-spacing:-0.02em;color:#005131">${escapeEmailText(data.heading)}</td></tr>`,
      `<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:0 32px 26px"><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse"><tbody>`,
    ]

    data.items.forEach((item, index) => {
      const isLast = index === data.items.length - 1
      const rule = isLast ? '' : 'border-bottom:1px solid #efe9dd;'
      const tag = item.tag
        ? ` <span style="font-family:'Outfit',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.12em;color:#006b45">${escapeEmailText(item.tag)}</span>`
        : ''

      rows.push(
        `<tr><td valign="baseline" style="padding:16px 12px 4px 0;${rule}font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:19px;line-height:25px;color:#1a1a1a">${escapeEmailText(item.name)}${tag}</td><td valign="baseline" align="right" width="70" style="width:70px;padding:16px 0 4px;${rule}font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:19px;line-height:25px;color:#8b6914">${escapeEmailText(item.price)}</td></tr>`,
      )
      rows.push(
        `<tr><td colspan="2" style="padding:6px 0 ${isLast ? '0' : '14px'};${rule}font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:#6f6a61">${escapeEmailText(item.description)}</td></tr>`,
      )
    })

    rows.push(`</tbody></table></td></tr>`)
    rows.push(`</tbody></table>`)

    return rows.join('\n')
  },
  text: (data) => {
    const items = data.items.map((item) => {
      const name = item.tag ? `${item.name} (${item.tag})` : item.name
      return `${name} ${item.price}\n${item.description}`
    })

    return `${data.heading}\n\n${items.join('\n\n')}\n`
  },
})
