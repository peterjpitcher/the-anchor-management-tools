/**
 * The B2B marketing sender.
 *
 * This is the only place in the app that puts marketing email on the wire, and it has three
 * jobs it must never get wrong: never send twice, never send to someone who has opted out,
 * and never send while the kill switch is off.
 *
 * Almost none of that safety lives here. The database owns it, because the checks and the
 * state change have to happen in one transaction under a lock:
 *
 *   * `claim_marketing_recipients` checks the kill switch, the send window, eligibility,
 *     unsubscribes, do-not-contact and the frequency cap under a CONTACT-row lock, marks
 *     its own skips, and hands back only rows it has already moved to 'sending' with a
 *     lease. A row this route never sees is a row it can never send to.
 *   * `finalise_marketing_send` and `release_marketing_claim` move the recipient, the
 *     contact and the reservation together, so a crash cannot leave a half-finished send.
 *
 * What this route adds is the provider call and the honest reporting of what came back.
 * Every decision below is biased the same way: when we cannot prove an email was NOT sent,
 * we do not send it again, we park it for a human.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { sendEmail } from '@/lib/email/emailService'
import {
  getOrCreateContactUnsubscribeUrl,
  getOrCreateUnsubscribeUrl,
} from '@/lib/email/unsubscribe'
import {
  getMarketingConfig,
  isMarketingHardDisabled,
  MARKETING_UTM_MEDIUM,
  MARKETING_UTM_SOURCE,
} from '@/lib/email/marketing/config'
import { marketingContentSchema, type MarketingContent } from '@/lib/email/marketing/registry'
import { renderMarketingEmail } from '@/lib/email/marketing/render'
// Lives outside this file because a Next.js route may only export its route handlers and
// config; exporting the classifier from here fails the production build.
import { classifySendFailure, type FailureClass } from '@/lib/email/marketing/send-failures'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * Stop starting new work at 45 seconds against a 60 second function limit.
 *
 * The gap is not padding for its own sake. A send that is in flight when the platform kills
 * the function is the single worst outcome this route can produce: the provider may well
 * have accepted it while nothing local recorded that it did, which leaves a row that only a
 * human can safely resolve. Fifteen seconds is enough for the slowest realistic provider
 * call plus the release calls for whatever is still claimed.
 */
const RUN_DEADLINE_MS = 45_000

/** Standard backoff for a failure we expect to clear on its own. */
const RETRY_BACKOFF_SECONDS = 300

const DEFAULT_BATCH_SIZE = 25
const MIN_BATCH_SIZE = 1
/** The claim RPC raises above 200, so clamp rather than let a bad setting abort the run. */
const MAX_BATCH_SIZE = 200


interface ClaimedRecipient {
  id: string
  campaign_id: string
  contact_id: string | null
  customer_id: string | null
  email: string
}

interface LoadedCampaign {
  id: string
  subject: string
  content: MarketingContent
  linkMap: Record<string, string>
  utmCampaign: string
}

type CampaignLoad =
  | { ok: true; campaign: LoadedCampaign }
  | { ok: false; failureClass: FailureClass; error: string }


function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown error'
}

async function readBatchSize(supabase: SupabaseClient<any, 'public', any>): Promise<number> {
  const { data, error } = await supabase
    .from('marketing_settings')
    .select('batch_size')
    .limit(1)
    .maybeSingle()

  if (error) {
    logger.error('Marketing cron could not read batch size, using the default', {
      error: new Error(error.message),
    })
    return DEFAULT_BATCH_SIZE
  }

  const configured = Number((data as { batch_size?: number } | null)?.batch_size)
  if (!Number.isFinite(configured)) return DEFAULT_BATCH_SIZE
  return Math.min(MAX_BATCH_SIZE, Math.max(MIN_BATCH_SIZE, Math.trunc(configured)))
}

async function loadCampaign(
  supabase: SupabaseClient<any, 'public', any>,
  campaignId: string
): Promise<CampaignLoad> {
  const { data, error } = await supabase
    .from('marketing_campaigns')
    .select('id, subject, content, link_map, utm_campaign')
    .eq('id', campaignId)
    .maybeSingle()

  if (error) {
    return { ok: false, failureClass: 'retryable', error: `Campaign lookup failed: ${error.message}` }
  }
  if (!data) {
    return { ok: false, failureClass: 'terminal', error: 'Campaign no longer exists' }
  }

  const row = data as {
    id: string
    subject: string
    content: unknown
    link_map: unknown
    utm_campaign: string | null
  }

  // Re-validated here even though it was validated when the campaign was written. A deploy
  // between those two moments can change what the renderer accepts, and finding that out
  // mid-send is exactly what this catches.
  const parsed = marketingContentSchema.safeParse(row.content)
  if (!parsed.success) {
    const issue = parsed.error.errors[0]
    const path = issue?.path?.length ? `${issue.path.join('.')}: ` : ''
    return {
      ok: false,
      failureClass: 'terminal',
      error: `Campaign content is invalid: ${path}${issue?.message ?? 'unknown problem'}`,
    }
  }

  return {
    ok: true,
    campaign: {
      id: row.id,
      subject: row.subject,
      content: parsed.data,
      linkMap: (row.link_map as Record<string, string> | null) ?? {},
      utmCampaign: row.utm_campaign ?? row.id,
    },
  }
}

/**
 * Tag the recipient's durable unsubscribe URL with this campaign's recipient row.
 *
 * The token itself identifies the person and never changes, so the extra parameter is the
 * only way the unsubscribe route can tell WHICH email drove the opt-out. Built with URL so
 * it composes with the existing `?t=` parameter instead of guessing at separators.
 */
function withRecipientAttribution(unsubscribeUrl: string, recipientId: string): string {
  try {
    const url = new URL(unsubscribeUrl)
    url.searchParams.set('c', recipientId)
    return url.toString()
  } catch {
    // A URL we cannot parse is still a working link, so send it as it is rather than lose
    // the opt-out over an attribution nicety.
    return unsubscribeUrl
  }
}

async function releaseClaim(
  supabase: SupabaseClient<any, 'public', any>,
  recipientId: string,
  failureClass: FailureClass,
  error: string,
  backoffSeconds: number
): Promise<void> {
  const { error: rpcError } = await supabase.rpc('release_marketing_claim', {
    p_recipient_id: recipientId,
    p_failure_class: failureClass,
    p_error: error.slice(0, 2000),
    p_backoff_seconds: backoffSeconds,
  })

  if (rpcError) {
    // The lease expiry in `recover_stale_marketing_claims` is the backstop for this, so the
    // row is not lost; it just takes ten minutes longer to come back.
    logger.error('Marketing cron could not release a claimed recipient', {
      error: new Error(rpcError.message),
      metadata: { recipientId, failureClass },
    })
  }
}

async function finaliseSend(
  supabase: SupabaseClient<any, 'public', any>,
  recipientId: string,
  emailMessageId: string | null,
  providerMessageId: string | null,
  needsReview: boolean
): Promise<void> {
  const { error } = await supabase.rpc('finalise_marketing_send', {
    p_recipient_id: recipientId,
    p_email_message_id: emailMessageId,
    p_provider_message_id: providerMessageId,
    p_needs_review: needsReview,
  })

  if (error) {
    // Serious: the email is gone but the row still says 'sending'. Logged loudly because the
    // lease recovery will see a row with an email_messages link and close it as sent, which
    // is right, but only if that link was written.
    logger.error('Marketing cron sent an email but could not finalise the recipient row', {
      error: new Error(error.message),
      metadata: { recipientId, emailMessageId, providerMessageId, needsReview },
    })
  }
}

async function handle(request: NextRequest) {
  const startedAt = Date.now()
  const runStartedIso = new Date(startedAt).toISOString()
  const elapsed = () => Date.now() - startedAt

  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  // 1. Configuration guard.
  //
  // Answered 200, not 500, on purpose. An environment where marketing was never configured
  // is not a failure, and returning 500 every five minutes would bury real cron alerts under
  // noise until somebody muted the lot.
  if (isMarketingHardDisabled()) {
    console.warn('[marketing-campaigns] MARKETING_SEND_ENABLED=false, sending is hard disabled')
    return NextResponse.json({ skipped: 'not_configured', missing: ['MARKETING_SEND_ENABLED=false'] })
  }

  const config = getMarketingConfig()
  if (!config.ok) {
    // console.warn rather than logger.warn: the project logger drops warnings outside
    // development, and this needs to be visible in the production cron log.
    console.warn(`[marketing-campaigns] not configured, missing: ${config.missing.join(', ')}`)
    return NextResponse.json({ skipped: 'not_configured', missing: config.missing })
  }

  const supabase = createAdminClient()

  const result = {
    recovered: 0,
    quarantined: 0,
    promoted: 0,
    claimed: 0,
    sent: 0,
    needsReview: 0,
    skipped: 0,
    failed: 0,
    deferred: 0,
    completed: 0,
  }

  // 2. Recover leases left behind by a run that died mid-batch.
  const { data: recovery, error: recoveryError } = await supabase.rpc('recover_stale_marketing_claims')
  if (recoveryError) {
    logger.error('Marketing cron could not recover stale claims', {
      error: new Error(recoveryError.message),
    })
  } else {
    const row = Array.isArray(recovery) ? recovery[0] : recovery
    result.recovered = Number((row as { recovered?: number } | null)?.recovered ?? 0)
    result.quarantined = Number((row as { quarantined?: number } | null)?.quarantined ?? 0)
  }

  // 3. Promote anything due. The RPC checks the send window and snapshots the audience in
  // one transaction, so there is nothing to check here first.
  const { data: promoted, error: promoteError } = await supabase.rpc('promote_due_marketing_campaigns')
  if (promoteError) {
    logger.error('Marketing cron could not promote due campaigns', {
      error: new Error(promoteError.message),
    })
  } else {
    result.promoted = Array.isArray(promoted) ? promoted.length : 0
  }

  // 4. Claim and send.
  const batchSize = await readBatchSize(supabase)
  const campaignCache = new Map<string, CampaignLoad>()
  let claimError: string | null = null
  let deadlineReached = false

  while (!deadlineReached) {
    if (elapsed() > RUN_DEADLINE_MS) {
      deadlineReached = true
      break
    }

    const { data: claimedRows, error: claimRpcError } = await supabase.rpc('claim_marketing_recipients', {
      p_batch: batchSize,
    })

    if (claimRpcError) {
      claimError = claimRpcError.message
      logger.error('Marketing cron could not claim recipients', {
        error: new Error(claimRpcError.message),
      })
      break
    }

    const batch = (claimedRows ?? []) as ClaimedRecipient[]
    if (batch.length === 0) break
    result.claimed += batch.length

    for (let index = 0; index < batch.length; index++) {
      const row = batch[index]

      // 4a. Deadline budget. Everything still claimed is handed straight back with a zero
      // backoff so the next run picks it up immediately rather than waiting out the lease.
      if (elapsed() > RUN_DEADLINE_MS) {
        deadlineReached = true
        for (const pending of batch.slice(index)) {
          await releaseClaim(supabase, pending.id, 'retryable', 'Run deadline reached', 0)
          result.deferred++
        }
        break
      }

      try {
        // 4b. Campaign, cached because a batch is usually all one campaign.
        let load = campaignCache.get(row.campaign_id)
        if (!load) {
          load = await loadCampaign(supabase, row.campaign_id)
          // Only settled outcomes are cached. A transient lookup failure must not poison the
          // rest of the run.
          if (load.ok || load.failureClass === 'terminal') {
            campaignCache.set(row.campaign_id, load)
          }
        }

        if (!load.ok) {
          await releaseClaim(
            supabase,
            row.id,
            load.failureClass,
            load.error,
            load.failureClass === 'retryable' ? RETRY_BACKOFF_SECONDS : 0
          )
          result.failed++
          continue
        }

        const campaign = load.campaign

        // 4c. No working opt-out, no send. The soft opt-in basis the whole programme stands
        // on holds only while every message carries one, so this is a hard stop rather than
        // a degraded send.
        // A recipient is one population or the other, enforced by a CHECK constraint. Each
        // has its own durable unsubscribe token, so the guest path uses the customer token
        // that already existed for booking confirmations rather than minting a second one.
        const subjectId = row.customer_id ?? row.contact_id
        if (!subjectId) {
          await releaseClaim(supabase, row.id, 'terminal', 'Recipient has neither a contact nor a customer', 0)
          result.failed++
          continue
        }

        const baseUnsubscribeUrl = row.customer_id
          ? await getOrCreateUnsubscribeUrl(supabase, row.customer_id)
          : await getOrCreateContactUnsubscribeUrl(supabase, row.contact_id as string)
        if (!baseUnsubscribeUrl) {
          await releaseClaim(
            supabase,
            row.id,
            'retryable',
            'No unsubscribe URL could be issued for this contact',
            RETRY_BACKOFF_SECONDS
          )
          result.failed++
          continue
        }

        // 4d. Attribute a resulting opt-out to this exact send.
        const unsubscribeUrl = withRecipientAttribution(baseUnsubscribeUrl, row.id)

        // 4e. Render. A throw here is a fault in the stored content or an oversized email,
        // and neither fixes itself on a retry.
        let rendered
        try {
          rendered = renderMarketingEmail(campaign.content, {
            unsubscribeUrl,
            linkMap: campaign.linkMap,
            // One short link serves the whole audience, so this parameter is the only thing
            // that tells a click apart from every other recipient's.
            recipientRef: row.id,
            utm: {
              source: MARKETING_UTM_SOURCE,
              medium: MARKETING_UTM_MEDIUM,
              campaign: campaign.utmCampaign,
            },
          })
        } catch (renderError) {
          await releaseClaim(supabase, row.id, 'terminal', `Render failed: ${errorMessage(renderError)}`, 0)
          result.failed++
          continue
        }

        // 4f. The provider call. Resend only: the idempotency key is what makes a retry safe,
        // and Graph has no equivalent.
        const sendResult = await sendEmail({
          to: row.email,
          subject: campaign.subject,
          html: rendered.html,
          text: rendered.text,
          provider: 'resend',
          from: config.from,
          replyTo: config.replyTo,
          suppressionMode: 'fail_closed',
          idempotencyKey: `marketing:${row.campaign_id}:${subjectId}`,
          commType: 'marketing_campaign',
          businessContactId: row.contact_id,
          customerId: row.customer_id,
          marketingCampaignId: row.campaign_id,
          marketingRecipientId: row.id,
          unsubscribeUrl,
          metadata: { campaign_id: row.campaign_id, recipient_id: row.id },
        })

        const providerMessageId = sendResult.messageId ?? null

        // 4g. Outcomes.
        if (sendResult.success) {
          if (typeof sendResult.emailMessageId === 'string') {
            await finaliseSend(supabase, row.id, sendResult.emailMessageId, providerMessageId, false)
            result.sent++
            continue
          }

          // THE EMAIL WENT OUT. Only the local log row failed to write.
          //
          // This must never be retried. The recipient has the email in their inbox; a second
          // attempt outside the provider's idempotency retention would put a second copy
          // there, and a duplicate marketing email is precisely the complaint that costs the
          // venue its sending reputation. Parked as needs_review so a human reconciles it
          // against the provider dashboard instead.
          await finaliseSend(supabase, row.id, null, providerMessageId, true)
          result.needsReview++
          logger.error('Marketing email sent but the local log row was not written', {
            metadata: { recipientId: row.id, campaignId: row.campaign_id, providerMessageId },
          })
          continue
        }

        // The suppression list could not be read, so nothing was attempted. Mailing an
        // address that has bounced or complained is worse than mailing it late, which is why
        // marketing fails closed here where transactional mail would send anyway.
        if (sendResult.suppressionCheckUnavailable) {
          await releaseClaim(
            supabase,
            row.id,
            'retryable',
            sendResult.error || 'Suppression list could not be checked',
            RETRY_BACKOFF_SECONDS
          )
          result.skipped++
          continue
        }

        // The same sent-but-unlogged hazard as above, reached by a different branch inside
        // sendEmail: the provider handed back an id, then the logging write threw. The email
        // exists, so this is parked rather than retried for exactly the same reason.
        if (providerMessageId) {
          await finaliseSend(supabase, row.id, null, providerMessageId, true)
          result.needsReview++
          logger.error('Marketing email accepted by the provider but reported as failed', {
            metadata: {
              recipientId: row.id,
              campaignId: row.campaign_id,
              providerMessageId,
              error: sendResult.error,
            },
          })
          continue
        }

        const message = sendResult.error || 'Unknown send failure'
        const failureClass = classifySendFailure(message)
        await releaseClaim(
          supabase,
          row.id,
          failureClass,
          message,
          failureClass === 'retryable' ? RETRY_BACKOFF_SECONDS : 0
        )
        result.failed++
      } catch (unexpected) {
        // One malformed row must not abort the batch. Released as retryable because an
        // unexpected throw is, by definition, not proof that anything was sent, and the
        // attempt counter caps how often this can repeat.
        const message = errorMessage(unexpected)
        logger.error('Marketing cron failed while processing a recipient', {
          error: unexpected instanceof Error ? unexpected : new Error(message),
          metadata: { recipientId: row.id, campaignId: row.campaign_id },
        })
        await releaseClaim(supabase, row.id, 'retryable', message, RETRY_BACKOFF_SECONDS)
        result.failed++
      }
    }

    // A short batch means the queue is drained for now, so stop rather than spin.
    if (batch.length < batchSize) break
  }

  // Skips are marked inside the claim RPC and never surface in its result, so they are
  // counted afterwards. Observability only, and approximate: it compares against this
  // process's clock rather than the database's.
  const { count: skippedCount, error: skippedError } = await supabase
    .from('marketing_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'skipped')
    .gte('updated_at', runStartedIso)

  if (!skippedError && typeof skippedCount === 'number') {
    result.skipped += skippedCount
  }

  // 5. Close out campaigns with nothing left in flight.
  const { data: completed, error: completeError } = await supabase.rpc(
    'complete_finished_marketing_campaigns'
  )
  if (completeError) {
    logger.error('Marketing cron could not complete finished campaigns', {
      error: new Error(completeError.message),
    })
  } else {
    result.completed = Number(completed ?? 0)
  }

  const body = { ...result, elapsedMs: elapsed() }

  // A failing claim RPC means the queue itself is broken, which is worth a cron alert. The
  // counters still go out so a partially successful run is not lost in the noise.
  if (claimError) {
    return NextResponse.json({ ...body, error: `Claim failed: ${claimError}` }, { status: 500 })
  }

  return NextResponse.json(body)
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}
