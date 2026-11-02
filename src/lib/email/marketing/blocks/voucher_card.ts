import { z } from 'zod'

import { GUEST } from '@/lib/brand/palette'

import { escapeEmailText } from '../escape'
import { defineBlock } from './types'

/**
 * The digital voucher card in the return-visit emails (November 2026 handover).
 *
 * The guest shows the email at the bar and staff read the number into the floor screen, so
 * the number is the largest thing on the card and sits in the sans stack: Georgia's figures
 * are old-style and 3, 4, 5, 7 and 9 drop below the line, which is harder to read aloud.
 *
 * The expiry date and the conditions are in the card itself rather than behind a link,
 * because CAP Code 8.17 wants every significant condition, the closing date included, in the
 * promotion. Do not trim them to save space.
 *
 * Five drawn variants, one template: 10% (the sample), 25% (headline and first condition
 * only), expiring (the date band turns dark gold for the 3-day reminder), no name (the name
 * row is dropped and the headline takes its bottom padding) and logo (optional; the masthead
 * already carries the wordmark and an image-blocked Outlook shows an empty box, so it is off
 * by default). Each variant has its own fixture, checked in `voucherCard.variants.test.ts`.
 *
 * The card carries no link on purpose. The Book a table button underneath is the tap target,
 * and a linked number would open a browser on a long press instead of selecting the text.
 */

/** The hosted black wordmark, the same file the cream masthead uses. Never a relative path. */
const LOGO_URL = 'https://www.the-anchor.pub/images/branding/the-anchor-pub-logo-black-transparent.png'

const BODY_FONT = `'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif`
const DISPLAY_FONT = `'DM Serif Display',Georgia,'Times New Roman',serif`

export const voucherCardSchema = z.object({
  kicker: z.string().min(1).max(40),
  /** "10% off your food". Wraps to two lines on a phone, which the design allows for. */
  headline: z.string().min(1).max(60),
  /** First name only. Empty drops the name row rather than printing "For 's table". */
  first_name: z.string().max(60).optional(),
  /** As the ledger issues it, for example AN-2611-0042. */
  number: z.string().min(1).max(40),
  /** Full date with the day name: "Thursday 11 December 2026". */
  expiry_date: z.string().min(1).max(60),
  how_to_use: z.string().min(1).max(120),
  /** Six to eight short lines, all printed in full. */
  conditions: z.array(z.string().min(1).max(160)).min(6).max(8),
  /** The 3-day reminder treatment: dark gold date band reading "Expiring soon". */
  expiring: z.boolean().optional(),
  show_logo: z.boolean().optional(),
})

export type VoucherCardData = z.infer<typeof voucherCardSchema>

function conditionRow(condition: string): string {
  return `<tr><td width="14" valign="top" style="width:14px;padding:4px 0 0;font-family:${BODY_FONT};font-size:14px;line-height:22px;mso-line-height-rule:exactly;color:${GUEST.accentText}">&bull;</td><td valign="top" style="padding:4px 0 0;font-family:${BODY_FONT};font-size:14px;line-height:22px;mso-line-height-rule:exactly;color:${GUEST.textMuted}">${escapeEmailText(condition)}</td></tr>
`
}

function nameLine(firstName: string): string {
  return `For ${firstName}\u2019s table`
}

export const voucherCard = defineBlock<VoucherCardData>({
  type: 'voucher_card',
  fixture: 'lib_voucher_card.html',
  schema: voucherCardSchema,
  sample: {
    kicker: 'Your voucher',
    headline: '10% off your food',
    first_name: 'Sarah',
    number: 'AN-2611-0042',
    expiry_date: 'Thursday 11 December 2026',
    how_to_use: 'Book a table, then show this email at the bar.',
    conditions: [
      '10% off food for the booked table, in one visit.',
      'Drinks are not included.',
      'Not valid with the Christmas menu or special occasion menus.',
      'Book your table in advance.',
      'One voucher per table.',
      'Cannot be used with any other offer.',
      'Show this email at the bar so we can read the voucher number.',
    ],
    expiring: false,
    show_logo: false,
  },
  render: (data) => {
    const firstName = (data.first_name ?? '').trim()
    const band = data.expiring ? GUEST.goldDark : GUEST.sand
    const bandText = data.expiring ? GUEST.surface : GUEST.green
    const expiryLabel = data.expiring ? 'Expiring soon' : 'Valid until'
    const expiryLine = data.expiring ? `Valid until ${data.expiry_date}` : data.expiry_date

    const logoRow = data.show_logo
      ? `<tr><td align="center" style="padding:26px 28px 0"><img src="${LOGO_URL}" width="112" height="56" alt="The Anchor" style="display:block;width:112px;height:56px;border:0;margin:0 auto"></td></tr>
`
      : ''
    const nameRow = firstName
      ? `<tr><td align="center" style="padding:8px 28px 24px;font-family:${BODY_FONT};font-size:16px;line-height:24px;mso-line-height-rule:exactly;color:${GUEST.text}">${escapeEmailText(nameLine(firstName))}</td></tr>
`
      : ''

    return `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:${GUEST.cream}"><tbody>
<tr><td bgcolor="${GUEST.cream}" class="gutter" style="background-color:${GUEST.cream};padding:32px"><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse;background-color:${GUEST.surface};border:2px dashed ${GUEST.gold}"><tbody>
${logoRow}<tr><td align="center" style="padding:${data.show_logo ? '16px' : '28px'} 28px 0;font-family:${BODY_FONT};font-size:11px;font-weight:600;line-height:16px;mso-line-height-rule:exactly;letter-spacing:0.18em;text-transform:uppercase;color:${GUEST.accentText}">${escapeEmailText(data.kicker)}</td></tr>
<tr><td align="center" style="padding:10px 28px ${firstName ? '0px' : '24px'};font-family:${DISPLAY_FONT};font-size:32px;font-weight:400;line-height:38px;mso-line-height-rule:exactly;letter-spacing:-0.02em;color:${GUEST.green}">${escapeEmailText(data.headline)}</td></tr>
${nameRow}<tr><td align="center" bgcolor="${GUEST.green}" style="background-color:${GUEST.green};padding:18px 12px 0;font-family:${BODY_FONT};font-size:11px;font-weight:600;line-height:16px;mso-line-height-rule:exactly;letter-spacing:0.18em;text-transform:uppercase;color:${GUEST.creamText}">Voucher number</td></tr>
<tr><td align="center" bgcolor="${GUEST.green}" class="vc-num" style="background-color:${GUEST.green};padding:4px 12px 20px;font-family:${BODY_FONT};font-size:36px;font-weight:700;line-height:44px;mso-line-height-rule:exactly;letter-spacing:4px;color:${GUEST.surface}">${escapeEmailText(data.number)}</td></tr>
<tr><td align="center" bgcolor="${band}" style="background-color:${band};padding:16px 12px 0;font-family:${BODY_FONT};font-size:11px;font-weight:600;line-height:16px;mso-line-height-rule:exactly;letter-spacing:0.18em;text-transform:uppercase;color:${bandText}">${expiryLabel}</td></tr>
<tr><td align="center" bgcolor="${band}" class="vc-date" style="background-color:${band};padding:2px 12px 18px;font-family:${BODY_FONT};font-size:20px;line-height:28px;mso-line-height-rule:exactly;color:${bandText};font-weight:600">${escapeEmailText(expiryLine)}</td></tr>
<tr><td align="center" style="padding:22px 28px 0;font-family:${BODY_FONT};font-size:15px;line-height:24px;mso-line-height-rule:exactly;color:${GUEST.text}">${escapeEmailText(data.how_to_use)}</td></tr>
<tr><td style="padding:20px 28px 26px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;border-top:1px solid ${GUEST.border}"><tbody>
<tr><td colspan="2" style="padding:18px 0 4px;font-family:${BODY_FONT};font-size:11px;font-weight:600;line-height:16px;mso-line-height-rule:exactly;letter-spacing:0.18em;text-transform:uppercase;color:${GUEST.accentText}">Conditions</td></tr>
${data.conditions.map(conditionRow).join('')}</tbody></table></td></tr>
</tbody></table></td></tr>
</tbody></table>`
  },
  text: (data) => {
    const firstName = (data.first_name ?? '').trim()
    const lines = [
      data.kicker,
      data.headline,
      ...(firstName ? [nameLine(firstName)] : []),
      `Voucher number: ${data.number}`,
      data.expiring ? `Expiring soon. Valid until ${data.expiry_date}` : `Valid until ${data.expiry_date}`,
      data.how_to_use,
      'Conditions:',
      ...data.conditions.map((condition) => `- ${condition}`),
    ]
    return `${lines.join('\n')}\n`
  },
})
