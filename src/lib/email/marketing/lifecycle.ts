import { z } from 'zod'

import type { MarketingContent } from './registry'
import type { ReturnVisitFilter } from '@/types/marketing'

/**
 * Lifecycle campaign settings (spec tasks/spec-2026-11-02-table-booking-return-visits.md,
 * sections 7 and 9). Pure: no database, so the service, the scripts and the tests share one
 * definition of what a valid return-visit campaign is.
 *
 * The database checks the same shape (constraint marketing_campaigns_lifecycle_fields and
 * get_table_return_visit_audience), so this is the friendly first refusal, not the only one.
 */

/** Per-recipient values a lifecycle email may use. Anything else is a typo. */
export const LIFECYCLE_MERGE_TOKENS = [
  'first_name',
  'voucher_expires_on',
  'voucher_number',
  'voucher_percent',
] as const

const isoWeekday = z.number().int().min(1).max(7)

export const returnVisitFilterSchema = z
  .object({
    rule: z.literal('table_return_visit'),
    touch: z.union([z.literal(1), z.literal(2)]),
    days_since_anchor_min: z.number().int().min(1).max(730).optional(),
    days_since_anchor_max: z.number().int().min(1).max(730).optional(),
    days_since_previous_touch_min: z.number().int().min(1).max(730).optional(),
    previous_campaign_id: z.string().uuid().nullable().optional(),
    include_no_shows: z.boolean().optional(),
    voucher_type_id: z.string().min(1),
    voucher_valid_days: z.number().int().min(7).max(90).optional(),
  })
  .superRefine((filter, ctx) => {
    if (filter.touch === 1) {
      if (filter.days_since_anchor_min === undefined || filter.days_since_anchor_max === undefined) {
        ctx.addIssue({ code: 'custom', message: 'Touch 1 needs the days-since-visit window' })
      } else if (filter.days_since_anchor_min > filter.days_since_anchor_max) {
        ctx.addIssue({ code: 'custom', message: 'The days-since-visit window is the wrong way round' })
      }
    }
    if (filter.touch === 2) {
      if (!filter.previous_campaign_id) {
        ctx.addIssue({ code: 'custom', message: 'Touch 2 needs the touch 1 campaign it follows' })
      }
      if (filter.days_since_previous_touch_min === undefined) {
        ctx.addIssue({ code: 'custom', message: 'Touch 2 needs the days since touch 1' })
      }
    }
  })

export const lifecycleSettingsSchema = z.object({
  customerFilter: returnVisitFilterSchema,
  cooldownDays: z.number().int().min(1).max(730),
  sendDays: z
    .array(isoWeekday)
    .min(1, 'Choose at least one send day')
    .max(7)
    .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
  promoteAtLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time such as 16:00'),
  holdoutPercent: z.number().int().min(0).max(50),
})

export type LifecycleSettings = z.input<typeof lifecycleSettingsSchema>
export type ParsedLifecycleSettings = z.output<typeof lifecycleSettingsSchema>

export function parseLifecycleSettings(input: unknown): ParsedLifecycleSettings {
  const parsed = lifecycleSettingsSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const path = first?.path?.length ? `${first.path.join('.')}: ` : ''
    throw new Error(`The return-visit settings are invalid. ${path}${first?.message ?? 'Unknown problem'}`)
  }
  return parsed.data
}

/**
 * Content-level checks for a lifecycle email. A voucher touch must show the voucher, with its
 * number and closing date filled per guest, because the email is the voucher and CAP Code 8.17
 * wants the expiry and conditions in the body. Returns the problems, empty when sound.
 */
export function lifecycleContentProblems(content: MarketingContent, filter: ReturnVisitFilter): string[] {
  const problems: string[] = []
  const serialised = JSON.stringify(content)

  for (const match of serialised.matchAll(/\{\{\s*([a-z_]+)/g)) {
    if (!(LIFECYCLE_MERGE_TOKENS as readonly string[]).includes(match[1])) {
      problems.push(`The copy uses {{${match[1]}}}, which is not a value a return-visit email can fill`)
    }
  }

  if (filter.voucher_type_id) {
    const cards = content.blocks.filter((block) => block.type === 'voucher_card')
    if (cards.length !== 1) {
      problems.push('A voucher email needs exactly one voucher card')
    } else {
      const card = JSON.stringify(cards[0].data)
      if (!card.includes('{{voucher_number}}')) problems.push('The voucher card must show {{voucher_number}}')
      if (!card.includes('{{voucher_expires_on}}')) problems.push('The voucher card must show {{voucher_expires_on}}')
    }
  }

  return [...new Set(problems)]
}

const WEEKDAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** "Thursday", "Wednesday and Thursday". For the campaign page. */
export function describeSendDays(days: number[] | null): string {
  const names = (days ?? []).filter((day) => day >= 1 && day <= 7).map((day) => WEEKDAY_NAMES[day])
  if (names.length === 0) return 'No send days'
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** One plain sentence saying who a return-visit campaign picks. For the campaign page. */
export function describeReturnVisitFilter(filter: ReturnVisitFilter): string {
  const noShows = filter.include_no_shows === false ? '' : ', no-shows included'
  const voucher = filter.voucher_type_id ? ` They get a ${filter.voucher_valid_days ?? 30}-day ${filter.voucher_type_id} voucher.` : ''
  if (filter.touch === 2) {
    return (
      `Guests whose first return-visit email went at least ${filter.days_since_previous_touch_min ?? 45} days ago, ` +
      `whose voucher ran out unused and who have not booked since${noShows}.${voucher}`
    )
  }
  return (
    `Guests whose last table visit was ${filter.days_since_anchor_min ?? 45} to ${filter.days_since_anchor_max ?? 180} days ago ` +
    `and who have not booked since${noShows}.${voucher}`
  )
}
