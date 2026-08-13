import { z } from 'zod'

import { escapeEmailText } from '../escape'
import { defineBlock } from './types'

/**
 * Gold kicker, serif heading and one paragraph, on the default cream surface.
 *
 * Use it to open a second subject inside a longer email, where a full `hero_image` would
 * compete with the opener. Smaller heading than the hero on purpose: it starts a section,
 * it does not restart the email.
 *
 * No button. If the section needs an action, put a `buttons` block under it and keep the
 * email's one primary action intact.
 */

export const sectionIntroSchema = z.object({
  kicker: z.string().min(1).max(60),
  heading: z.string().min(1).max(120),
  body: z.string().min(1).max(400),
})

export type SectionIntroData = z.infer<typeof sectionIntroSchema>

export const sectionIntro = defineBlock<SectionIntroData>({
  type: 'section_intro',
  fixture: 'section_intro.html',
  schema: sectionIntroSchema,
  sample: {
    kicker: 'From 1 September 2026',
    heading: 'We are open from lunchtime again',
    body: 'Lunch is back on the menu. From Tuesday 1 September we are serving from midday, so a proper sit-down lunch is seven minutes from Terminal 5 again.',
  },
  render: (data) => `
<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:0 32px 6px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;line-height:16px;mso-line-height-rule:exactly;letter-spacing:0.18em;text-transform:uppercase;color:#8b6914">${escapeEmailText(data.kicker)}</td></tr>
<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:8px 32px 0;font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:32px;font-weight:400;line-height:38px;mso-line-height-rule:exactly;letter-spacing:-0.02em;color:#005131">${escapeEmailText(data.heading)}</td></tr>
<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:14px 32px 24px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:27px;mso-line-height-rule:exactly;color:#1a1a1a">${escapeEmailText(data.body)}</td></tr>
`,
  text: (data) => `${data.kicker.toUpperCase()}\n\n${data.heading}\n\n${data.body}\n`,
})
