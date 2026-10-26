import type { SupabaseClient } from '@supabase/supabase-js'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { reportPaymentAlert } from '@/lib/cron/alerting'
import { getAppUrl } from '@/lib/env'
import { logger } from '@/lib/logger'

/**
 * The one way the app tells a manager that money needs a person (BK-114 and BK-018, customer
 * bookings review of 24 October 2026).
 *
 * A refund that failed, a payment PayPal is holding, a guest who paid for a booking that could
 * not take it, an amount that does not match: these used to reach an audit row or a log line
 * and stop, while the guest was told "the team has been notified". Nothing read either.
 *
 * Owner decision D17 (24 October 2026): booking and money problems that need a person go to the
 * manager inbox; failed scheduled jobs stay with CRON_ALERT_EMAIL. The inbox is the address the
 * invoice credit-note alerts already used.
 *
 * Each alert is sent once per booking and kind: the claim lives in `idempotency_keys`, as the
 * PayPal webhook's own claims do, so an hourly cron or a webhook retried by PayPal does not send
 * the same email again. A failed send releases the claim so the next run tries again. Staff only:
 * nothing here reaches a customer, and callers must not put a customer's name, email address or
 * phone number in the title, summary or context.
 */

export const MANAGER_ALERT_RECIPIENT = 'manager@the-anchor.pub'

export type MoneyAlertDomain = 'event_bookings' | 'table_bookings' | 'private_bookings' | 'invoices' | 'parking'

export type MoneyAlertInput = {
  domain: MoneyAlertDomain
  /** The booking (or other record) the money belongs to. */
  bookingId: string
  /** A stable short name for what went wrong. One email per booking and kind. */
  kind: string
  title: string
  summary: string
  /** Ids, amounts, statuses and reasons. Never a customer's name, email or phone number. */
  context?: Record<string, unknown>
  /** Overrides the once-key, for alerts that are once per something else (a PayPal refund id). */
  onceKey?: string
  /** A page for the manager to open, when there is one that takes this record's id. */
  path?: string | null
}

export type MoneyAlertOutcome = { sent: boolean; duplicate: boolean }

const ALERT_TTL_HOURS = 24 * 30

const DOMAIN_PATH: Partial<Record<MoneyAlertDomain, (id: string) => string>> = {
  invoices: (id) => `/invoices/${id}`,
  private_bookings: (id) => `/private-bookings/${id}`,
  table_bookings: (id) => `/table-bookings/${id}`,
}

function linkFor(input: MoneyAlertInput): string | null {
  const path = input.path ?? DOMAIN_PATH[input.domain]?.(input.bookingId) ?? null
  if (!path) return null
  try {
    return `${getAppUrl()}${path}`
  } catch {
    return null
  }
}

export function moneyAlertOnceKey(input: Pick<MoneyAlertInput, 'domain' | 'bookingId' | 'kind' | 'onceKey'>): string {
  return input.onceKey ?? `money-alert:${input.domain}:${input.bookingId}:${input.kind}`
}

/** Never throws: the caller has already done, or failed to do, the money work it reports. */
export async function alertMoneyNeedsAPerson(
  supabase: SupabaseClient<any, 'public', any>,
  input: MoneyAlertInput,
): Promise<MoneyAlertOutcome> {
  const onceKey = moneyAlertOnceKey(input)
  const requestHash = computeIdempotencyRequestHash({ onceKey })

  let claimed = false
  try {
    const claim = await claimIdempotencyKey(supabase, onceKey, requestHash, ALERT_TTL_HOURS)
    if (claim.state !== 'claimed') {
      logger.info('Money alert already raised for this booking', {
        metadata: { onceKey, domain: input.domain, bookingId: input.bookingId, kind: input.kind, claim: claim.state },
      })
      return { sent: false, duplicate: true }
    }
    claimed = true
  } catch (claimError) {
    // Could not check whether the manager was already told. Tell them anyway: a duplicate
    // email is a far smaller problem than money nobody hears about.
    logger.error('Could not claim the money alert; sending it unclaimed', {
      error: claimError instanceof Error ? claimError : new Error(String(claimError)),
      metadata: { onceKey },
    })
  }

  const result = await reportPaymentAlert({
    title: input.title,
    summary: input.summary,
    to: MANAGER_ALERT_RECIPIENT,
    context: {
      Record: `${input.domain} ${input.bookingId}`,
      Link: linkFor(input),
      ...(input.context ?? {}),
    },
  })

  if (!result.sent) {
    logger.error('Money alert was NOT delivered', {
      error: new Error(`money_alert_${result.reason ?? 'not_sent'}`),
      metadata: { onceKey, domain: input.domain, bookingId: input.bookingId, kind: input.kind },
    })
  }

  if (claimed) {
    try {
      if (result.sent) {
        await persistIdempotencyResponse(supabase, onceKey, requestHash, { state: 'alerted', kind: input.kind }, ALERT_TTL_HOURS)
      } else {
        await releaseIdempotencyClaim(supabase, onceKey, requestHash)
      }
    } catch (persistError) {
      logger.error('Could not settle the money alert claim', {
        error: persistError instanceof Error ? persistError : new Error(String(persistError)),
        metadata: { onceKey },
      })
    }
  }

  return { sent: result.sent, duplicate: false }
}

export function formatPounds(amount: number | null | undefined): string {
  return typeof amount === 'number' && Number.isFinite(amount) ? `£${amount.toFixed(2)}` : 'an unknown amount'
}
