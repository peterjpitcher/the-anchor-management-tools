import { z } from 'zod'

import { escapeEmailText } from '../escape'
import { defineBlock } from './types'

/**
 * Numbered steps in green circles, mirroring the booking explainer on the website.
 *
 * Use it when a reader has to do something in order and might otherwise assume it is
 * complicated. Three steps is the sweet spot: the numbers come from the row order, so
 * reordering the array renumbers the circles.
 */

export const stepsSchema = z.object({
  heading: z.string().min(1).max(120),
  steps: z
    .array(
      z.object({
        title: z.string().min(1).max(80),
        body: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(6),
})

export type StepsData = z.infer<typeof stepsSchema>

export const steps = defineBlock<StepsData>({
  type: 'steps',
  fixture: 'lib_steps.html',
  schema: stepsSchema,
  sample: {
    heading: 'Booking takes three steps',
    steps: [
      {
        title: 'Choose your sitting',
        body: 'Lunch or dinner, your date and your guest count.',
      },
      {
        title: 'Confirm and pay the deposit',
        body: '£10 per person, taken off your final bill.',
      },
      {
        title: 'Send your pre-order',
        body: 'Everyone’s courses and dietaries, 7 days before your date.',
      },
    ],
  },
  render: (data) => {
    const rows: string[] = [
      `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#faf8f3"><tbody>`,
      `<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:32px 32px 8px;font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:26px;line-height:32px;letter-spacing:-0.02em;color:#005131">${escapeEmailText(data.heading)}</td></tr>`,
      `<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:0 32px 30px"><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse"><tbody>`,
    ]

    data.steps.forEach((step, index) => {
      rows.push(
        `<tr><td width="44" valign="top" style="width:44px;padding:18px 0 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tbody><tr><td align="center" bgcolor="#005131" width="32" height="32" style="width:32px;height:32px;background-color:#005131;border-radius:999px;font-family:'Outfit',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff">${index + 1}</td></tr></tbody></table></td><td valign="top" style="padding:18px 0 0"><div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;line-height:24px;color:#1a1a1a">${escapeEmailText(step.title)}</div><div style="font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:#6f6a61">${escapeEmailText(step.body)}</div></td></tr>`,
      )
    })

    rows.push(`</tbody></table></td></tr>`)
    rows.push(`</tbody></table>`)

    return rows.join('\n')
  },
  text: (data) => {
    const lines = data.steps.map((step, index) => `${index + 1}. ${step.title}\n${step.body}`)

    return `${data.heading}\n\n${lines.join('\n\n')}\n`
  },
})
