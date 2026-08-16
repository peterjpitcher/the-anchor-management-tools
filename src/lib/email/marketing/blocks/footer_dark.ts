import { z } from 'zod'

import { escapeEmailText } from '../escape'
import { defineBlock } from './types'

/**
 * Dark footer on deep green, with the Clicker Script "Where everyone's welcome" line.
 *
 * Pair it with dark-themed sends. Address, phone, socials, the reminder of why this email
 * arrived, and the unsubscribe are all required on every marketing send.
 *
 * The unsubscribe link uses `escapeEmailText` rather than `escapeEmailUrl`. The handover
 * ships the send-time placeholder `%%unsubscribe%%`, which `escapeEmailUrl` would reject
 * for not being absolute. At send time the renderer substitutes a real absolute https URL
 * and validates it there, so the attribute only ever needs HTML escaping here, which
 * `escapeEmailText` does over the same character set.
 */

export const footerDarkSchema = z.object({
  unsubscribe_url: z.string().min(1),
  // Same slots as the light footer, and for the same reason: the handover's fixed line claims
  // every recipient enquired with us, which is false for a prospecting list. Optional so the
  // block still reproduces the handover file exactly when they are omitted.
  reason_for_contact: z.string().min(1).max(300),
  privacy_notice_url: z.string().url().optional(),
  year: z.string().regex(/^\d{4}$/).optional(),
})

export type FooterDarkData = z.infer<typeof footerDarkSchema>

/** The designer's own wording, kept as the default so the fixture still matches exactly. */
const HANDOVER_REASON = 'You are receiving this because you enquired about a booking or an event with us.'

export const footerDark = defineBlock<FooterDarkData>({
  type: 'footer_dark',
  fixture: 'lib_footer_dark.html',
  schema: footerDarkSchema,
  sample: {
    // The handover ships the send-time placeholder token rather than a real link.
    unsubscribe_url: '%%unsubscribe%%',
    // Stated rather than left to a default. This is the handover's own wording, so the
    // fixture is byte-identical, but no campaign can now omit the field and ship it by
    // accident: why somebody is being emailed has to be a decision, not a fallback.
    reason_for_contact: HANDOVER_REASON,
  },
  render: (data) =>
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#0c1d11"><tbody>
<tr><td bgcolor="#0c1d11" align="center" style="background-color:#0c1d11;border-top:1px solid rgba(201,160,32,0.35);padding:30px 32px 34px">
<div style="font-family:'Clicker Script','Segoe Script','Brush Script MT',cursive;font-size:26px;line-height:32px;color:#c9a020;padding-bottom:10px">Where everyone&rsquo;s welcome</div>
<div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;line-height:21px;color:#f0e6c6">The Anchor, Horton Road, Stanwell Moor, Surrey TW19 6AQ<br>01753 682707 &middot; <a href="https://www.the-anchor.pub" style="color:#f0e6c6;text-decoration:underline">the-anchor.pub</a></div>
<div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;line-height:21px;color:#7a8b7f;padding-top:12px"><a href="https://www.facebook.com/theanchorpubsm/" style="color:#7a8b7f;text-decoration:underline">Facebook</a> &nbsp;&middot;&nbsp; <a href="https://www.instagram.com/theanchor.pub/" style="color:#7a8b7f;text-decoration:underline">Instagram</a></div>
<div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;line-height:19px;color:#7a8b7f;padding-top:16px">${escapeEmailText(data.reason_for_contact)}<br><a href="${escapeEmailText(data.unsubscribe_url)}" style="color:#7a8b7f;text-decoration:underline">Unsubscribe</a>${data.privacy_notice_url ? ` &nbsp;&middot;&nbsp; <a href="${escapeEmailText(data.privacy_notice_url)}" style="color:#7a8b7f;text-decoration:underline">Privacy notice</a>` : ''} &nbsp;&middot;&nbsp; &copy; ${escapeEmailText(data.year ?? '2026')} The Anchor, Stanwell Moor Village</div>
</td></tr>
</tbody></table>`,
  text: (data) =>
    `Where everyone's welcome\nThe Anchor, Horton Road, Stanwell Moor, Surrey TW19 6AQ\n01753 682707 - https://www.the-anchor.pub\nFacebook: https://www.facebook.com/theanchorpubsm/\nInstagram: https://www.instagram.com/theanchor.pub/\n\n${data.reason_for_contact}\nUnsubscribe: ${data.unsubscribe_url}\n(c) ${data.year ?? '2026'} The Anchor, Stanwell Moor Village\n`,
})
