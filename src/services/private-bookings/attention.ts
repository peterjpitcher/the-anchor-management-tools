import { createAdminClient } from '@/lib/supabase/admin'
import { getAppUrl } from '@/lib/env'
import { formatDateInLondon } from '@/lib/dateUtils'
import { sendEmail } from '@/lib/email/emailService'
import { formatPrivateBookingReference } from '@/lib/email/private-booking-emails'
import { PRIVATE_BOOKINGS_MANAGER_EMAIL } from '@/lib/private-bookings/manager-notifications'
import { isBookingDateTbd } from '@/lib/private-bookings/tbd-detection'
import {
  hireRoomProblems,
  isPaidButNotConfirmed,
  loadHireReadinessFacts,
  type HireProblem,
} from './readiness'

/**
 * The daily check on upcoming private hires (review BK-005 and BK-007, 24 October 2026). Run by
 * the private-booking-monitor cron once a day, it emails the manager every upcoming live hire
 * that has:
 * - its deposit paid but is still a draft, with the reasons recorded when it did not confirm;
 * - no room booked, no guest count, or more guests than its rooms hold.
 *
 * A live hire is a confirmed one, a draft with its deposit paid, or a draft whose hold has not
 * run out: the hires that are holding a date. A fresh enquiry with no hold is not listed, and
 * neither is a hire whose date is still to be confirmed.
 *
 * The email names each booking by its reference, date, guest count and event type, with a link.
 * No customer name, phone number or email address goes in it.
 */

// `any` because the session client, the admin client and the test fakes share no exported type.
type DbClient = ReturnType<typeof createAdminClient> | any

export interface HireNeedingAttention {
  bookingId: string
  reference: string
  eventDate: string
  status: string
  guestCount: number | null
  eventType: string | null
  issues: string[]
}

function roomIssue(problem: HireProblem): string {
  if (problem.code === 'no_room') return 'No room booked.'
  if (problem.code === 'no_guest_count') return 'No guest count set.'
  return problem.message
}

function sentence(text: string): string {
  const trimmed = text.trim()
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

/**
 * Every upcoming live hire with something wrong, soonest first. Throws when a read fails, so the
 * caller can report it rather than send a list that looks clean.
 */
export async function findHiresNeedingAttention(input: {
  todayIso: string
  now: Date
  db?: DbClient
}): Promise<HireNeedingAttention[]> {
  const db = input.db ?? createAdminClient()
  const { data, error } = await db
    .from('private_bookings')
    .select('id, status, event_date, event_type, guest_count, hold_expiry, deposit_paid_date, date_tbd, internal_notes')
    .in('status', ['draft', 'confirmed'])
    .gte('event_date', input.todayIso)
    .order('event_date', { ascending: true })
  if (error) throw new Error(`Could not read the upcoming private hires: ${error.message}`)

  const nowMs = input.now.getTime()
  const live = ((data ?? []) as Array<Record<string, unknown>>).filter((booking) => {
    if (isBookingDateTbd(booking as { date_tbd?: boolean | null; internal_notes?: string | null })) return false
    if (booking.status === 'confirmed') return true
    if (booking.deposit_paid_date) return true
    const holdExpiry = typeof booking.hold_expiry === 'string' ? Date.parse(booking.hold_expiry) : NaN
    return Number.isFinite(holdExpiry) && holdExpiry > nowMs
  })
  if (live.length === 0) return []

  const { facts, rooms } = await loadHireReadinessFacts(live.map((booking) => String(booking.id)), { db })

  const result: HireNeedingAttention[] = []
  for (const booking of live) {
    const id = String(booking.id)
    const one = facts.get(id)
    if (!one) continue
    const issues: string[] = []
    if (isPaidButNotConfirmed(one)) {
      const reasons = one.lastConfirmationBlock?.reasons ?? []
      issues.push(
        reasons.length > 0
          ? `Deposit paid, not confirmed: ${reasons.map(sentence).join(' ')}`
          : 'Deposit paid, not confirmed. No reason was recorded.',
      )
    }
    for (const problem of hireRoomProblems(one, rooms)) issues.push(roomIssue(problem))
    if (issues.length === 0) continue
    result.push({
      bookingId: id,
      reference: formatPrivateBookingReference(id),
      eventDate: String(booking.event_date),
      status: String(booking.status),
      guestCount: one.guestCount,
      eventType: typeof booking.event_type === 'string' && booking.event_type.trim() ? booking.event_type.trim() : null,
      issues,
    })
  }
  return result
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * The rest of the private hire to-do list the same daily email carries, beyond the upcoming hires
 * above. Counts and short lines only: no customer name, phone number or email address.
 */
export interface PrivateHireToDo {
  /** Texts that have waited for staff approval for more than a day (BK-064). */
  textsAwaitingApproval: number
}

const EMPTY_TO_DO: PrivateHireToDo = { textsAwaitingApproval: 0 }

const APPROVAL_WAIT_MS = 24 * 60 * 60 * 1000

/** Everything on the to-do list. Throws when a read fails, so the caller can say so. */
export async function findPrivateHireToDo(input: { now: Date; db?: DbClient }): Promise<PrivateHireToDo> {
  const db = input.db ?? createAdminClient()
  const waitingSince = new Date(input.now.getTime() - APPROVAL_WAIT_MS).toISOString()
  const { data, error } = await db
    .from('private_booking_sms_queue')
    .select('id')
    .eq('status', 'pending')
    .lt('created_at', waitingSince)
  if (error) throw new Error(`Could not read the texts waiting for approval: ${error.message}`)
  return { textsAwaitingApproval: (data ?? []).length }
}

function hasToDo(toDo: PrivateHireToDo): boolean {
  return toDo.textsAwaitingApproval > 0
}

function toDoLines(toDo: PrivateHireToDo, appUrl: string): Array<{ text: string; url: string }> {
  const lines: Array<{ text: string; url: string }> = []
  if (toDo.textsAwaitingApproval > 0) {
    const count = toDo.textsAwaitingApproval
    lines.push({
      text: `${count} private hire ${count === 1 ? 'text has' : 'texts have'} waited more than a day for approval.`,
      url: `${appUrl}/private-bookings/sms-queue`,
    })
  }
  return lines
}

/** The manager's email for these hires, and the rest of the to-do list. */
export function buildHireAttentionEmail(items: HireNeedingAttention[], appUrl: string, toDo: PrivateHireToDo = EMPTY_TO_DO): {
  subject: string
  html: string
  text: string
} {
  const count = items.length
  const extra = toDoLines(toDo, appUrl)
  const subject = count > 0
    ? `Private hires needing attention: ${count} ${count === 1 ? 'booking' : 'bookings'}`
    : `Private hire to-do: ${extra.length} ${extra.length === 1 ? 'item' : 'items'}`
  const intro = count > 0
    ? 'These upcoming private hires need sorting out. Until they are, a paid hire stays a draft, and a hire with no room, or with more guests than its room holds, leaves the rest of the pub on sale.'
    : 'Nothing is wrong with the upcoming private hires. These need doing:'

  const describe = (item: HireNeedingAttention): string => {
    const date = formatDateInLondon(item.eventDate, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    const guests = item.guestCount !== null ? `${item.guestCount} guests` : 'guest count not set'
    const what = item.eventType ? `, ${item.eventType}` : ''
    const status = item.status === 'confirmed' ? 'confirmed' : 'draft'
    return `${item.reference}: ${date}, ${guests}${what} (${status})`
  }

  const htmlItems = items.map((item) => {
    const url = `${appUrl}/private-bookings/${item.bookingId}`
    return [
      '<li style="margin-bottom: 12px;">',
      `<strong>${escapeHtml(describe(item))}</strong>`,
      '<ul>',
      ...item.issues.map((issue) => `<li>${escapeHtml(issue)}</li>`),
      '</ul>',
      `<a href="${escapeHtml(url)}">Open the booking</a>`,
      '</li>',
    ].join('')
  })

  const extraHtml = extra.length === 0 ? [] : [
    count > 0 ? '<p>Also to do:</p>' : '',
    '<ul>',
    ...extra.map((line) => `<li>${escapeHtml(line.text)} <a href="${escapeHtml(line.url)}">Open</a></li>`),
    '</ul>',
  ]
  const html = [`<p>${escapeHtml(intro)}</p>`, ...(count > 0 ? ['<ul>', ...htmlItems, '</ul>'] : []), ...extraHtml].join('')
  const text = [
    intro,
    '',
    ...items.flatMap((item) => [
      describe(item),
      ...item.issues.map((issue) => `- ${issue}`),
      `Open the booking: ${appUrl}/private-bookings/${item.bookingId}`,
      '',
    ]),
    ...(extra.length > 0 && count > 0 ? ['Also to do:'] : []),
    ...extra.flatMap((line) => [`- ${line.text}`, `  ${line.url}`]),
  ].join('\n')

  return { subject, html, text }
}

/** Finds the hires and the rest of the to-do list, and emails the manager when there is any. Never throws. */
export async function runHireAttentionCheck(input: {
  todayIso: string
  now: Date
  db?: DbClient
}): Promise<{ listed: number; emailed: boolean; error?: string }> {
  let items: HireNeedingAttention[]
  try {
    items = await findHiresNeedingAttention(input)
  } catch (error) {
    return { listed: 0, emailed: false, error: error instanceof Error ? error.message : String(error) }
  }

  // The to-do list is read separately, so a failure there still lets the hires above go out.
  let toDo = EMPTY_TO_DO
  let toDoError: string | undefined
  try {
    toDo = await findPrivateHireToDo(input)
  } catch (error) {
    toDoError = error instanceof Error ? error.message : String(error)
  }
  if (items.length === 0 && !hasToDo(toDo)) {
    return toDoError ? { listed: 0, emailed: false, error: toDoError } : { listed: 0, emailed: false }
  }

  try {
    const email = buildHireAttentionEmail(items, getAppUrl(), toDo)
    const result = await sendEmail({ to: PRIVATE_BOOKINGS_MANAGER_EMAIL, ...email })
    return result.success
      ? { listed: items.length, emailed: true, ...(toDoError ? { error: toDoError } : {}) }
      : { listed: items.length, emailed: false, error: result.error || 'The email was not sent' }
  } catch (error) {
    return { listed: items.length, emailed: false, error: error instanceof Error ? error.message : String(error) }
  }
}
