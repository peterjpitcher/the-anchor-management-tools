import { escapeHtml } from '@/lib/cron/alerting'
import { formatDateInLondon, shiftIsoDate, toLocalIsoDate, whenLondonClockReaches } from '@/lib/dateUtils'
import { STAFF } from '@/lib/brand/palette'
import { funnelKeyIds } from '@/lib/booking-funnel/daily-summary'
import type { BookingForm } from '@/lib/booking-funnel/events'
import type { createAdminClient } from '@/lib/supabase/admin'

/**
 * A form that people fill in and nothing arrives from (growth review of 13 November 2026).
 *
 * Private hire enquiries were dead from 11 to 27 August 2026 and nobody noticed for sixteen days,
 * because a form that sends nothing looks exactly like a quiet fortnight. The website now reports
 * the same signals for its private hire enquiry forms as for the event booking form, and this
 * looks at the last seven London days for a form that was used but never sent.
 *
 * The rule (owner approved): at least 2 `submit_pressed` and no `sent`, or at least 5 `started`
 * and no `sent`. Opens never count, on their own or towards either figure: crawlers open forms
 * (316 times in one day on 1 November 2026) and type nothing.
 *
 * Codes and counts only; booking_funnel_events holds no visitor details, so neither does this.
 */

type AdminClient = ReturnType<typeof createAdminClient>

/** The forms watched. The event booking form has its own daily summary lines and is not listed. */
export const QUIET_FORM_WATCH: readonly BookingForm[] = ['private_hire_enquiry']

const QUIET_FORM_WINDOW_DAYS = 7
const QUIET_FORM_MIN_SUBMITS = 2
const QUIET_FORM_MIN_STARTS = 5

const QUIET_FORM_LABELS: Record<string, string> = { private_hire_enquiry: 'Private hire enquiry form' }

export type QuietFormCounts = {
  form: string
  /** The first and last London dates counted, YYYY-MM-DD. */
  from: string
  to: string
  opened: number
  started: number
  submitPressed: number
  sent: number
  /** The London date of the newest started or submit pressed signal counted, or null for none. */
  latestSignalDate: string | null
}

type QuietFormReason = 'submits_without_sent' | 'starts_without_sent'

/** Why a form counts as quiet, or null when it does not. Opens play no part. */
function quietFormReason(counts: Pick<QuietFormCounts, 'started' | 'submitPressed' | 'sent'>): QuietFormReason | null {
  if (counts.sent > 0) return null
  if (counts.submitPressed >= QUIET_FORM_MIN_SUBMITS) return 'submits_without_sent'
  if (counts.started >= QUIET_FORM_MIN_STARTS) return 'starts_without_sent'
  return null
}

/**
 * The once-only key for an alert, or null when the form is not quiet. It is the date of the newest
 * signal, not the date of the run: one bad afternoon is one email, not the same email every
 * morning for a week; a form still failing as people keep trying is reported again each day
 * something new arrives; and an alert that could not be sent (email down, a missed run) is still
 * owed the next morning, for as long as the signals stay inside the seven days.
 */
export function quietFormAlertKey(counts: QuietFormCounts): string | null {
  if (quietFormReason(counts) === null || !counts.latestSignalDate) return null
  return `website-quiet-form:${counts.form}:${counts.latestSignalDate}`
}

/** How long a sent alert is remembered: longer than the days counted, so it cannot be sent twice. */
export const QUIET_FORM_CLAIM_TTL_HOURS = (QUIET_FORM_WINDOW_DAYS + 2) * 24

function londonMidnightIso(date: string): string {
  const instant = whenLondonClockReaches(date, '00:00')
  if (!instant) throw new Error(`Not a date: ${date}`)
  return instant.toISOString()
}

/**
 * Counts one form's signals over the seven London days that end on `lastDate` (yesterday, when the
 * daily job calls it). Only keys that can make bookings are counted, so a test or preview key
 * cannot raise or hide an alert. Throws when a count cannot be made.
 */
export async function loadQuietFormCounts(supabase: AdminClient, form: string, lastDate: string): Promise<QuietFormCounts> {
  const from = shiftIsoDate(lastDate, -(QUIET_FORM_WINDOW_DAYS - 1))
  const dayAfter = shiftIsoDate(lastDate, 1)
  if (!from || !dayAfter) throw new Error(`Not a date: ${lastDate}`)
  const startIso = londonMidnightIso(from)
  const endIso = londonMidnightIso(dayAfter)

  const keys = await funnelKeyIds(supabase)
  if (keys.length === 0) throw new Error('No API key that can make bookings was found, so nothing could be counted.')

  const countStep = async (steps: string[], sinceIso: string): Promise<number> => {
    const { count, error } = await supabase
      .from('booking_funnel_events')
      .select('id', { count: 'exact', head: true })
      .eq('stage', 'form')
      .eq('route', form)
      .in('reason_code', steps)
      .in('api_key_id', keys)
      .gte('occurred_at', sinceIso)
      .lt('occurred_at', endIso)
    if (error) throw new Error(`Could not count ${form} signals: ${error.message}`)
    return count ?? 0
  }

  const newestSignal = async (): Promise<string | null> => {
    const { data, error } = await supabase
      .from('booking_funnel_events')
      .select('occurred_at')
      .eq('stage', 'form')
      .eq('route', form)
      .in('reason_code', ['started', 'submit_pressed'])
      .in('api_key_id', keys)
      .gte('occurred_at', startIso)
      .lt('occurred_at', endIso)
      .order('occurred_at', { ascending: false })
      .limit(1)
    if (error) throw new Error(`Could not read the newest ${form} signal: ${error.message}`)
    const occurredAt = ((data ?? []) as Array<{ occurred_at: string }>)[0]?.occurred_at
    return occurredAt ? toLocalIsoDate(new Date(occurredAt)) : null
  }

  const [opened, started, submitPressed, sent, latestSignalDate] = await Promise.all([
    countStep(['opened'], startIso),
    countStep(['started'], startIso),
    countStep(['submit_pressed'], startIso),
    countStep(['sent'], startIso),
    newestSignal(),
  ])

  return { form, from, to: lastDate, opened, started, submitPressed, sent, latestSignalDate }
}

export type QuietFormEmail = { subject: string; html: string; text: string }

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

export function buildQuietFormEmail(counts: QuietFormCounts): QuietFormEmail {
  const label = QUIET_FORM_LABELS[counts.form] ?? counts.form
  const day = (date: string) => formatDateInLondon(`${date}T12:00:00Z`, { weekday: 'long', day: 'numeric', month: 'long' })
  const reason = quietFormReason(counts)
  const headline =
    reason === 'starts_without_sent'
      ? `${plural(counts.started, 'visitor')} started it and none was sent`
      : `submit was pressed ${plural(counts.submitPressed, 'time')} and none was sent`
  const subject = `${label}: ${headline} in the last ${QUIET_FORM_WINDOW_DAYS} days`

  const intro =
    `From ${day(counts.from)} to ${day(counts.to)} the website's ${label.toLowerCase()} was used but nothing was sent from it. ` +
    'That can mean the form is broken, or that people are giving up part-way. Either way an enquiry may have been lost.'
  const lines = [
    `Opened: ${counts.opened} (includes crawlers, so this number alone means nothing).`,
    `Started filling in: ${counts.started}.`,
    `Submit pressed: ${counts.submitPressed}.`,
    `Sent: ${counts.sent}.`,
  ]
  const action =
    'What to do: send a test enquiry from the website and check it arrives in Private Bookings. ' +
    'If it does not arrive, the form needs fixing today.'
  const footer = 'No visitor details are kept or sent: only codes and counts. Signals sent with a test or preview key are left out.'

  const text = [intro, '', ...lines.map((line) => `- ${line}`), '', action, '', footer].join('\n')
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;">
      <h2 style="color:${STAFF.text};">${escapeHtml(subject)}</h2>
      <p style="font-size:14px;line-height:1.5;">${escapeHtml(intro)}</p>
      <ul style="font-size:14px;line-height:1.5;margin:0;padding-left:20px;">
        ${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('\n        ')}
      </ul>
      <p style="font-size:14px;line-height:1.5;">${escapeHtml(action)}</p>
      <p style="font-size:13px;line-height:1.5;color:${STAFF.textMuted};">${escapeHtml(footer)}</p>
    </div>`.trim()

  return { subject, html, text }
}
