import { z } from 'zod'

import { escapeEmailText } from '../escape'
import { defineBlock } from './types'

/**
 * Cream footer: address, phone, socials, why this email arrived, and the unsubscribe link.
 *
 * Two slots exist here that the designer's file did not have, both for good reason.
 *
 * `reason_for_contact` is a slot because the supplied copy said the recipient had enquired
 * about a booking or an event. That is true of the guest list it was written for and false
 * of a researched business contact, and an email that opens by telling the reader something
 * untrue about themselves is both a brand failure and a transparency problem. The default
 * used for B2B sends states the actual position instead.
 *
 * `privacy_notice_url` is optional so this block still reproduces the handover file exactly
 * when omitted, which is what the fidelity test checks. In production it is always supplied:
 * where contact details were collected from somewhere other than the person themselves, they
 * have to be told what is held and where it came from, and the privacy notice is where that
 * lives.
 */

export const footerSchema = z.object({
  unsubscribe_url: z.string().min(1),
  reason_for_contact: z.string().min(1).max(300),
  privacy_notice_url: z.string().url().optional(),
  year: z.string().regex(/^\d{4}$/),
})

export type FooterData = z.infer<typeof footerSchema>

/** Truthful default for business contacts, whether or not they have dealt with us before. */
export const B2B_REASON_FOR_CONTACT =
  'You are receiving this because we contacted you in your business capacity.'

export const footer = defineBlock<FooterData>({
  type: 'footer',
  fixture: 'footer.html',
  schema: footerSchema,
  sample: {
    unsubscribe_url: '%%unsubscribe%%',
    reason_for_contact: 'You are receiving this because you enquired about a booking or an event with us.',
    year: '2026',
  },
  render: (data) => {
    // escapeEmailText rather than escapeEmailUrl: the renderer validates the unsubscribe URL
    // before it reaches any block, and the fidelity fixture carries the designer's
    // placeholder token rather than a real absolute URL.
    const privacyLink = data.privacy_notice_url
      ? ` &nbsp;&middot;&nbsp; <a href="${escapeEmailText(data.privacy_notice_url)}" style="color:#8f897e;text-decoration:underline">Privacy notice</a>`
      : ''

    return `<tr><td bgcolor="#f2ede3" align="center" style="background-color:#f2ede3;padding:30px 32px 34px">
<div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;line-height:16px;letter-spacing:0.18em;text-transform:uppercase;color:#8b6914;padding-bottom:10px">Where everyone&rsquo;s welcome</div>
<div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;line-height:21px;color:#6f6a61">The Anchor, Horton Road, Stanwell Moor, Surrey TW19 6AQ<br>01753 682707 &middot; <a href="https://www.the-anchor.pub" style="color:#6f6a61;text-decoration:underline">the-anchor.pub</a></div>
<div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;line-height:21px;color:#6f6a61;padding-top:12px"><a href="https://www.facebook.com/theanchorpubsm/" style="color:#6f6a61;text-decoration:underline">Facebook</a> &nbsp;&middot;&nbsp; <a href="https://www.instagram.com/theanchor.pub/" style="color:#6f6a61;text-decoration:underline">Instagram</a></div>
<div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;line-height:19px;color:#8f897e;padding-top:16px">${escapeEmailText(data.reason_for_contact)}<br><a href="${escapeEmailText(data.unsubscribe_url)}" style="color:#8f897e;text-decoration:underline">Unsubscribe</a>${privacyLink} &nbsp;&middot;&nbsp; &copy; ${escapeEmailText(data.year)} The Anchor, Stanwell Moor Village</div>
</td></tr>
`
  },
  text: (data) =>
    [
      '',
      'The Anchor, Horton Road, Stanwell Moor, Surrey TW19 6AQ',
      '01753 682707 . https://www.the-anchor.pub',
      '',
      data.reason_for_contact,
      `Unsubscribe: ${data.unsubscribe_url}`,
      data.privacy_notice_url ? `Privacy notice: ${data.privacy_notice_url}` : '',
      `(c) ${data.year} The Anchor, Stanwell Moor Village`,
      '',
    ]
      .filter((line, index, all) => line !== '' || all[index - 1] !== '')
      .join('\n'),
})
