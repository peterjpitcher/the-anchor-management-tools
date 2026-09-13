import { z } from 'zod'

import { escapeEmailText, escapeEmailUrl } from '../escape'
import { defineBlock, type EmailImage } from './types'

/**
 * The monthly round-up, with artwork and a booking link on every row.
 *
 * `whats_on_list` is the same list without pictures: a green date badge, a title and a
 * link. This one exists because most events now have a poster, and a list of eight names
 * asks the reader to remember what each night is. It is one white bordered table with a
 * hairline between rows, so eight rows still read as a single list rather than eight cards.
 *
 * The image cell is 196px wide and the picture renders 180 wide, which is why `width` is
 * pinned: the markup carries `width:180px` in its own style, so an image attribute that
 * disagreed would render at one size and reserve space for another. `height` is the
 * caller's, taken from the artwork's own ratio. Both cells carry `class="stack"`, so on a
 * phone the picture sits above the words instead of squeezing them into a column.
 *
 * The picture and the link point at the same place, because a reader who taps a poster has
 * asked the same question as a reader who taps the link under it.
 */

/** The slot width the markup is drawn to. Not a default: the style attribute repeats it. */
const IMAGE_WIDTH = 180

/**
 * The designer's local placeholder, kept for a row with no artwork yet.
 *
 * Same contract as `image_full` and `hero_image`: an empty `src` reproduces the handover
 * byte for byte, and a real URL renders the photograph in its place. The path is relative
 * and so cannot resolve in an inbox, which is deliberate. It is a proof that the fixture
 * has not drifted, not something to send.
 */
const PLACEHOLDER_SRC = 'img/slot-16x9.png'

const eventImageSchema: z.ZodType<EmailImage> = z.object({
  /** Empty keeps the designer's placeholder. Otherwise an absolute https URL. */
  src: z.string(),
  alt: z.string().min(1).max(160),
  width: z.literal(IMAGE_WIDTH),
  height: z.number().int().positive(),
})

const whatsOnMediaEventSchema = z.object({
  /** Weekday and date as one label, e.g. "Wed 2 Dec". */
  date: z.string().min(1).max(24),
  name: z.string().min(1).max(80),
  /** About 90 characters. Longer wraps to a third line and unbalances the row. */
  detail: z.string().min(1).max(110),
  image: eventImageSchema,
  cta_label: z.string().min(1).max(40),
  url: z.string().min(1),
})

export type WhatsOnMediaEventData = z.infer<typeof whatsOnMediaEventSchema>

export const whatsOnMediaSchema = z.object({
  kicker: z.string().min(1).max(60),
  heading: z.string().min(1).max(120),
  events: z.array(whatsOnMediaEventSchema).min(1).max(8),
  all_events_url: z.string().min(1),
})

export type WhatsOnMediaData = z.infer<typeof whatsOnMediaSchema>

const SANS = "'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif"
const SERIF = "'DM Serif Display',Georgia,'Times New Roman',serif"

function imageSrc(image: EmailImage): string {
  return image.src.trim() ? escapeEmailUrl(image.src) : PLACEHOLDER_SRC
}

function eventRowMarkup(event: WhatsOnMediaEventData): string {
  const href = escapeEmailUrl(event.url)

  return [
    `<tr>`,
    `<td width="196" valign="top" class="stack" style="width:196px;padding:16px 16px 0 16px"><a href="${href}" style="text-decoration:none"><img src="${imageSrc(event.image)}" width="${event.image.width}" height="${event.image.height}" alt="${escapeEmailText(event.image.alt)}" style="display:block;width:100%;max-width:100%;height:auto;border:0"></a></td>`,
    `<td valign="top" class="stack" style="padding:14px 18px 16px 16px"><div style="font-family:${SANS};font-size:11px;font-weight:600;line-height:16px;letter-spacing:0.14em;text-transform:uppercase;color:#8b6914">${escapeEmailText(event.date)}</div><div style="font-family:${SERIF};font-size:19px;line-height:25px;color:#005131;padding-top:4px">${escapeEmailText(event.name)}</div><div style="font-family:${SANS};font-size:13px;line-height:20px;color:#6f6a61;padding-top:4px">${escapeEmailText(event.detail)}</div><div style="font-family:${SANS};font-size:14px;font-weight:600;line-height:20px;padding-top:8px"><a href="${href}" style="color:#8b6914;text-decoration:none">${escapeEmailText(event.cta_label)}</a></div></td>`,
    `</tr>`,
  ].join('\n')
}

/** The 1px rule between two rows. Never after the last one: it would double the border. */
const HAIRLINE_ROW = `<tr><td colspan="2" height="1" style="height:1px;background-color:#efe9dd;font-size:0;line-height:0;padding:0">&nbsp;</td></tr>`

export const whatsOnMedia = defineBlock<WhatsOnMediaData>({
  type: 'whats_on_media',
  fixture: 'lib_whats_on_media.html',
  schema: whatsOnMediaSchema,
  sample: {
    kicker: 'What’s on',
    heading: 'December at the pub',
    events: [
      {
        date: 'Wed 2 Dec',
        name: 'Quiz night',
        detail: '7pm start, teams of up to six, £2 a head, bar tab for the winners',
        image: { src: '', alt: 'Quiz night', width: 180, height: 101 },
        cta_label: 'Book a table →',
        url: 'https://www.the-anchor.pub/whats-on',
      },
      {
        date: 'Fri 4 Dec',
        name: 'Drag cabaret with Nikki Manfadge',
        detail: 'Doors 7pm, show 8pm. Free entry, book a table to be sure of a seat',
        image: { src: '', alt: 'Drag cabaret with Nikki Manfadge', width: 180, height: 101 },
        cta_label: 'Reserve your table →',
        url: 'https://www.the-anchor.pub/whats-on',
      },
      {
        date: 'Sat 12 Dec',
        name: 'Christmas karaoke',
        detail: 'From 8pm in the bar. Festive jumpers encouraged, singing voices optional',
        image: { src: '', alt: 'Christmas karaoke', width: 180, height: 101 },
        cta_label: 'Save your spot →',
        url: 'https://www.the-anchor.pub/whats-on',
      },
      {
        date: 'Wed 16 Dec',
        name: 'Cash bingo',
        detail: 'Eyes down 7.30pm. £10 for six games, cash prizes on the night',
        image: { src: '', alt: 'Cash bingo', width: 180, height: 101 },
        cta_label: 'Book a table →',
        url: 'https://www.the-anchor.pub/whats-on',
      },
    ],
    all_events_url: 'https://www.the-anchor.pub/whats-on',
  },
  render: (data) =>
    [
      `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#faf8f3"><tbody>`,
      `<tr><td bgcolor="#faf8f3" class="gutter" style="background-color:#faf8f3;padding:32px 32px 4px;font-family:${SANS};font-size:11px;font-weight:600;line-height:16px;letter-spacing:0.18em;text-transform:uppercase;color:#8b6914">${escapeEmailText(data.kicker)}</td></tr>`,
      `<tr><td bgcolor="#faf8f3" class="gutter" style="background-color:#faf8f3;padding:8px 32px 14px;font-family:${SERIF};font-size:26px;line-height:32px;letter-spacing:-0.02em;color:#005131">${escapeEmailText(data.heading)}</td></tr>`,
      `<tr><td bgcolor="#faf8f3" class="gutter" style="background-color:#faf8f3;padding:0 32px;"><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse;background-color:#ffffff;border:1px solid #e2dccf"><tbody>`,
      data.events.map(eventRowMarkup).join(`\n${HAIRLINE_ROW}\n`),
      `</tbody></table></td></tr>`,
      `<tr><td bgcolor="#faf8f3" class="gutter" style="background-color:#faf8f3;padding:14px 32px 30px;font-family:${SANS};font-size:14px;font-weight:600;line-height:20px"><a href="${escapeEmailUrl(data.all_events_url)}" style="color:#8b6914;text-decoration:none">See everything on this month &rarr;</a></td></tr>`,
      `</tbody></table>`,
    ].join('\n'),
  text: (data) => {
    // The detail line is a sentence the author wrote, so it usually ends in a full stop
    // already. Appending another gives "no horror knowledge needed.. Reserve your table",
    // which is the sort of thing only the plain-text part ever shows and nobody proofreads.
    const sentence = (value: string): string => (/[.!?]$/.test(value.trim()) ? value.trim() : `${value.trim()}.`)

    const events = data.events
      .map((event) => `${event.date}: ${sentence(event.name)} ${sentence(event.detail)} ${event.cta_label.replace(/\s*→$/, '')}: ${event.url}`)
      .join('\n')

    return `${data.kicker.toUpperCase()}\n${data.heading}\n${events}\nSee everything on this month: ${data.all_events_url}\n`
  },
})
