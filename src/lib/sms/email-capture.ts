/**
 * The email-capture SMS: asking guests we can text, but cannot email, for an address.
 *
 * Measured 19 August 2026: 466 customers are SMS-reachable with no email on file, 423 of
 * them have booked before. The guest email list is 225 people and opens at 41 to 56 per
 * cent, so this one send is the largest single addition available to it.
 *
 * Why this does not use sendBulkSms: that path takes one fixed body for every recipient.
 * Each guest here needs their own single-use link, so the loop below mints a token per
 * person and sends individually, exactly as cross-promo.ts does.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { sendSMS } from '@/lib/twilio'
import { logger } from '@/lib/logger'
import { getSmartFirstName } from '@/lib/sms/bulk'
import { countSmsSegments, normaliseToGsm7 } from '@/lib/sms/gsm7'
import { generateGuestToken, hashGuestToken } from '@/lib/guest/tokens'

/**
 * How long a capture link stays good.
 *
 * Long, because unlike a booking confirmation there is no event racing it: an address given
 * in three weeks is worth the same as one given today. Not unlimited, because a link that
 * writes to a customer record should not sit in an old text message indefinitely.
 */
const TOKEN_TTL_DAYS = 30

const SEND_LOOP_TIME_BUDGET_MS = 240_000 // 4 minutes, matching cross-promo's cron headroom
const SEND_LOOP_CHECK_INTERVAL = 25

/**
 * No opt-out line, by the owner's explicit decision on 2026-08-20, taken after being shown
 * that it costs nothing: every variant fits ONE segment with it and without it, and SMS is
 * billed per segment. This was a deliberate call, not an oversight, and it is recorded here
 * so nobody "fixes" it back without knowing that.
 *
 * What recipients still have: STOP, STOPALL, UNSUBSCRIBE and QUIT are honoured by
 * lib/sms/opt-out-keywords.ts and by the carriers themselves, so a guest is never trapped.
 *
 * What they lose is the granular route. NOEVENTS stopped marketing texts only and left
 * booking confirmations running; STOP stops everything. A guest who merely does not want
 * invites will now silence their own booking confirmations to get there.
 */
const OPT_OUT_TEXT = ''

export type EmailCaptureAudienceRow = {
  customer_id: string
  first_name: string | null
  phone_number: string
  last_activity_on: string | null
}

export type EmailCaptureSendResult = {
  sent: number
  skipped: number
  errors: number
  aborted?: boolean
  /** The safety code that ended the run early, if one did. Everyone left is still eligible. */
  stoppedBy?: string
  /** Tally of why sends failed, keyed by the safety or provider code. */
  failureCodes: Record<string, number>
}

function resolveAppBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
}

/**
 * A stand-in the length of a real shortened link, used only for measuring.
 *
 * sendSMS shortens every URL in the body before dispatch (lib/twilio.ts, via
 * shortenUrlsInSmsBody), so the raw /g/<43-char-token>/email-capture URL this module builds
 * is roughly 95 characters at build time and about 31 by the time it is sent
 * ("https://l.the-anchor.pub/" plus a 6-character code).
 *
 * Measuring the raw length would therefore reject every variant that actually fits, and
 * strip the guest's name from a message that had room for it.
 */
const SHORTENED_LINK_STAND_IN = 'https://l.the-anchor.pub/abc123'

/**
 * Pick the longest variant that still fits one SMS segment once the link is shortened.
 *
 * Segments are billed individually and this send goes to hundreds of people, so a body that
 * spills into a second segment doubles the cost of the whole exercise. The named variant is
 * tried first because a guest's own name is what makes this read as a message from the pub
 * rather than a broadcast.
 *
 * If shortening ever fails, shortenUrlsInSmsBody leaves the original URL in place and the
 * message costs two segments instead of one. That is the right way round: a more expensive
 * message still arrives, whereas refusing to send would lose the address entirely.
 *
 * The first variant was reworded on 2026-08-20 for two reasons. It now names the real scope
 * ("news, offers and what is on") rather than events alone, matching what the venue actually
 * sends. And it is shorter: the previous wording only fitted names up to five characters, so
 * anyone called Charlotte or Christopher silently dropped to the terse fallback and lost the
 * personalisation that makes this read as a message from the pub. Every realistic first name
 * now fits the full version.
 */
export function buildEmailCaptureMessage(firstName: string, link: string): string {
  const variants = [
    `The Anchor: ${firstName}, we have your number but not your email. Get our news, offers and what is on: LINK`,
    `The Anchor: ${firstName}, we have your number but not your email. Add it here: LINK`,
    `The Anchor: we have your number but not your email. Add it here: LINK`,
  ]

  const fits = (variant: string) =>
    countSmsSegments(
      normaliseToGsm7(variant.replace('LINK', SHORTENED_LINK_STAND_IN) + OPT_OUT_TEXT)
    ) === 1

  const chosen = variants.find(fits) ?? variants[variants.length - 1]
  return chosen.replace('LINK', link) + OPT_OUT_TEXT
}

/** Load the segment. Defined in the database so the preview and the send cannot disagree. */
export async function loadEmailCaptureAudience(
  maxRecipients: number
): Promise<EmailCaptureAudienceRow[]> {
  const db = createAdminClient()
  const { data, error } = await db.rpc('get_email_capture_audience', {
    p_max_recipients: maxRecipients,
  })

  if (error) {
    throw new Error(`Failed to load the email capture audience: ${error.message}`)
  }

  return (data as EmailCaptureAudienceRow[] | null) ?? []
}

/**
 * Does this failure doom the whole run, or just this one person?
 *
 * MATCH ON THE CODE, NEVER ON THE MESSAGE. lib/twilio.ts returns the identical string
 * 'SMS sending paused by safety guard' for EVERY safety outcome and puts the real reason in
 * `code`. An earlier version fell back to matching that message, so one recipient hitting
 * their own personal limit aborted a run of 100. That is what happened on the 11:08 run of
 * 2026-08-21: nothing was sent, and the report wrongly blamed the hourly limit when only 19
 * messages had gone out against a ceiling of 120.
 *
 * Fatal to the run:
 *   global_rate_limit   the hour's budget is gone, every remaining send would fail
 *   safety_unavailable  the guard cannot evaluate, so everything fails closed
 * Specific to one person, so the loop carries on:
 *   recipient_hourly_limit, recipient_daily_limit
 */
function isFatalToRun(result: { code?: string | null }): boolean {
  return result.code === 'global_rate_limit' || result.code === 'safety_unavailable'
}

async function sendSmsSafe(
  to: string,
  body: string,
  options: { customerId: string; metadata?: Record<string, unknown> }
): Promise<Awaited<ReturnType<typeof sendSMS>>> {
  try {
    return await sendSMS(to, body, options)
  } catch (err) {
    logger.warn('Failed sending an email capture SMS', {
      metadata: { to, error: err instanceof Error ? err.message : String(err) },
    })
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to send SMS',
    } as Awaited<ReturnType<typeof sendSMS>>
  }
}

/**
 * Send the ask.
 *
 * `dryRun` renders and counts everything without minting a token or sending a message, so
 * the exact bodies can be read before hundreds of real texts go out. It is the default
 * deliberately: nothing here should send because a caller forgot an argument.
 */
export async function sendEmailCaptureSms(options: {
  maxRecipients: number
  dryRun?: boolean
  startTime?: number
}): Promise<EmailCaptureSendResult & { preview: string[] }> {
  const db = createAdminClient()
  const dryRun = options.dryRun !== false
  const stats: EmailCaptureSendResult & { preview: string[] } = {
    sent: 0,
    skipped: 0,
    errors: 0,
    failureCodes: {},
    preview: [],
  }

  const audience = await loadEmailCaptureAudience(options.maxRecipients)
  if (audience.length === 0) {
    logger.info('Email capture: nobody is eligible', {})
    return stats
  }

  const baseUrl = resolveAppBaseUrl()
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

  let processed = 0

  for (const recipient of audience) {
    processed += 1

    // Counts ITERATIONS, not successful sends. Keying this off stats.sent meant a run where
    // sends stopped succeeding never checked the clock again, because the counter it watched
    // had frozen. That is exactly the run most likely to be crawling towards a timeout.
    if (options.startTime && processed % SEND_LOOP_CHECK_INTERVAL === 0) {
      const elapsed = Date.now() - options.startTime
      if (elapsed > SEND_LOOP_TIME_BUDGET_MS) {
        logger.warn('Email capture: aborting the send loop, approaching the time budget', {
          metadata: {
            sent: stats.sent,
            remaining: audience.length - processed,
            elapsedMs: elapsed,
          },
        })
        stats.aborted = true
        break
      }
    }

    const firstName = getSmartFirstName(recipient.first_name)

    if (dryRun) {
      // Shown exactly as the guest receives it, with the link already shortened.
      //
      // This previously rendered the RAW /g/<43-char-token>/email-capture URL, which was
      // actively misleading: staff approving the send read a message far longer than the one
      // that actually goes out, and could not see the short link at all. sendSMS shortens
      // every URL before dispatch, so the shortened form IS the truth.
      stats.preview.push(buildEmailCaptureMessage(firstName, SHORTENED_LINK_STAND_IN))
      stats.skipped += 1
      continue
    }

    // The raw token is generated in memory and its ROW IS WRITTEN ONLY AFTER A SUCCESSFUL
    // SEND. This ordering is the whole safety of the feature and it was originally the other
    // way round, which was a serious bug.
    //
    // get_email_capture_audience excludes anyone holding an email_capture token, so writing
    // the row first meant a send that never left the building still marked the guest as
    // asked, permanently. The original comment justified that by assuming failures would be
    // dead numbers. They are not: the dominant failure is the global 120-per-hour SMS safety
    // guard (lib/sms/safety.ts), which returns success:false for EVERY remaining recipient
    // once the hour's budget is gone. On a 423-person audience that would have silently
    // written off roughly 300 people who never received anything.
    //
    // Writing the row after the send inverts the failure: a crash between sending and
    // writing gives that one guest a link that reports itself expired, and the page hands
    // them the pub's phone number. Recoverable and visible, rather than silent and permanent.
    const rawToken = generateGuestToken()
    const link = `${baseUrl}/g/${rawToken}/email-capture`
    const body = buildEmailCaptureMessage(firstName, link)

    const result = await sendSmsSafe(recipient.phone_number, body, {
      customerId: recipient.customer_id,
      metadata: {
        template_key: 'email_capture_ask',
        marketing: true,
        idempotency_key: `email_capture_${recipient.customer_id}`,
      },
    })

    if (!result.success) {
      stats.errors += 1

      // Record WHY, tallied by code. Without this the operator sees a bare error count and
      // has to go digging in platform logs to find out whether it was a rate limit, a dead
      // number, or the guard being unable to evaluate at all.
      const code = (result as { code?: string | null }).code || 'unknown'
      stats.failureCodes[code] = (stats.failureCodes[code] ?? 0) + 1

      if (isFatalToRun(result)) {
        logger.warn('Email capture: stopping, this failure dooms the rest of the run', {
          metadata: { code, sent: stats.sent, remaining: audience.length - processed },
        })
        stats.stoppedBy = code
        break
      }

      continue
    }

    const { error: tokenError } = await db.from('guest_tokens').insert({
      hashed_token: hashGuestToken(rawToken),
      customer_id: recipient.customer_id,
      action_type: 'email_capture',
      expires_at: expiresAt,
    })

    if (tokenError) {
      // The guest has the text but the link will not resolve. Loud, because it is the one
      // case where somebody is asked and cannot answer, and staff may need to add the
      // address by hand.
      logger.error('Email capture: sent the text but could not store its token', {
        metadata: { customerId: recipient.customer_id, error: tokenError.message },
      })
    }

    stats.sent += 1
  }

  logger.info('Email capture send finished', {
    metadata: {
      dryRun,
      audienceSize: audience.length,
      sent: stats.sent,
      skipped: stats.skipped,
      errors: stats.errors,
      aborted: stats.aborted ?? false,
      stoppedBy: stats.stoppedBy ?? null,
      failureCodes: stats.failureCodes,
    },
  })

  return stats
}
