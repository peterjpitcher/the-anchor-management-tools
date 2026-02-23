#!/usr/bin/env tsx

import fs from 'node:fs/promises'
import path from 'node:path'
import dotenv from 'dotenv'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  createTablePaymentToken,
  getTablePaymentPreviewByRawToken,
  sendTableBookingCreatedSmsIfAllowed,
} from '@/lib/table-bookings/bookings'
import { parseTablePaymentLinkFromUrl } from '@/lib/table-bookings/payment-link'
import {
  assertScriptCompletedWithoutFailures,
  assertScriptMutationAllowed,
} from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'repair-table-payment-short-links'
const RUN_MUTATION_ENV = 'RUN_REPAIR_TABLE_PAYMENT_SHORT_LINKS_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_REPAIR_TABLE_PAYMENT_SHORT_LINKS_MUTATION_SCRIPT'
const HARD_CAP = 5000
const RESEND_DEDUPE_WINDOW_MS = 2 * 60 * 60 * 1000

type Args = {
  confirm: boolean
  dryRun: boolean
  limit: number | null
}

type ShortLinkRow = {
  id: string
  short_code: string
  destination_url: string
  metadata: Record<string, unknown> | null
}

type BookingRow = {
  id: string
  customer_id: string | null
  status: string | null
  hold_expires_at: string | null
  start_datetime: string | null
  party_size: number | null
}

type AuditRow = {
  short_link_id: string
  short_code: string
  destination_url_before: string
  destination_url_after: string | null
  classification: 'healthy' | 'recoverable' | 'unrecoverable' | 'reissued' | 'reissue_failed'
  reason_code: string
  table_booking_id: string | null
  customer_id: string | null
  resend_status: 'not_attempted' | 'sent' | 'skipped_recent_pending_payment_sms' | 'skipped_not_sendable' | 'failed'
  resend_detail: string | null
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  return TRUTHY.has(value.trim().toLowerCase())
}

function parseHttpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function toMetadataRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) }
  }
  return {}
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`Invalid positive integer: "${raw}"`)
  }

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer: "${raw}"`)
  }

  return parsed
}

function findFlagValue(argv: string[], flag: string): string | null {
  const withEqualsPrefix = `${flag}=`
  for (let i = 0; i < argv.length; i += 1) {
    const entry = argv[i]
    if (entry === flag) {
      const next = argv[i + 1]
      return typeof next === 'string' ? next : null
    }
    if (typeof entry === 'string' && entry.startsWith(withEqualsPrefix)) {
      return entry.slice(withEqualsPrefix.length)
    }
  }
  return null
}

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2)
  const confirm = rest.includes('--confirm')
  const dryRun = !confirm || rest.includes('--dry-run')
  const limit = parsePositiveInt(findFlagValue(rest, '--limit'))
  return { confirm, dryRun, limit }
}

function resolveAppBaseUrl(): string {
  const candidate = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return candidate.replace(/\/+$/, '')
}

function hasHoldExpired(holdExpiresAt: string | null): boolean {
  const holdMs = holdExpiresAt ? Date.parse(holdExpiresAt) : Number.NaN
  if (!Number.isFinite(holdMs)) return true
  return holdMs <= Date.now()
}

async function fetchShortLinks(
  supabase: ReturnType<typeof createAdminClient>,
  limit: number | null
): Promise<ShortLinkRow[]> {
  let query = (supabase.from('short_links') as any)
    .select('id, short_code, destination_url, metadata')
    .ilike('destination_url', '%/table-payment%')
    .order('created_at', { ascending: true })

  if (limit) {
    query = query.limit(limit)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(`Failed to load short links: ${error.message || 'unknown error'}`)
  }

  if (!Array.isArray(data)) {
    return []
  }

  return data as ShortLinkRow[]
}

async function loadBooking(
  supabase: ReturnType<typeof createAdminClient>,
  tableBookingId: string
): Promise<BookingRow | null> {
  const { data, error } = await (supabase.from('table_bookings') as any)
    .select('id, customer_id, status, hold_expires_at, start_datetime, party_size')
    .eq('id', tableBookingId)
    .maybeSingle()

  if (error) {
    throw new Error(`Booking lookup failed for ${tableBookingId}: ${error.message || 'unknown error'}`)
  }

  return (data || null) as BookingRow | null
}

async function loadRecentOutboundMessages(
  supabase: ReturnType<typeof createAdminClient>,
  customerId: string,
  thresholdIso: string
): Promise<Array<Record<string, unknown>>> {
  const attempts = [
    'id, created_at, table_booking_id, template_key, metadata',
    'id, created_at, table_booking_id, metadata',
    'id, created_at, metadata',
  ]

  let lastError: { message?: string } | null = null
  for (const selectColumns of attempts) {
    const { data, error } = await (supabase.from('messages') as any)
      .select(selectColumns)
      .eq('customer_id', customerId)
      .eq('direction', 'outbound')
      .gte('created_at', thresholdIso)
      .order('created_at', { ascending: false })
      .limit(100)

    if (!error) {
      return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : []
    }
    lastError = error
  }

  throw new Error(`Failed to query recent outbound messages: ${lastError?.message || 'unknown error'}`)
}

function hasRecentPendingPaymentSms(
  rows: Array<Record<string, unknown>>,
  tableBookingId: string
): boolean {
  for (const row of rows) {
    const metadata = toMetadataRecord(row.metadata)
    const templateKey = asNonEmptyString(row.template_key) || asNonEmptyString(metadata.template_key)
    const rowBookingId = asNonEmptyString(row.table_booking_id) || asNonEmptyString(metadata.table_booking_id)
    if (templateKey === 'table_booking_pending_payment' && rowBookingId === tableBookingId) {
      return true
    }
  }
  return false
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
  const args = parseArgs(process.argv)
  const supabase = createAdminClient()
  const appBaseUrl = resolveAppBaseUrl()

  if (!args.dryRun) {
    if (!args.confirm) {
      throw new Error(`[${SCRIPT_NAME}] mutation blocked: missing --confirm`)
    }
    if (!isTruthyEnv(process.env[RUN_MUTATION_ENV])) {
      throw new Error(
        `[${SCRIPT_NAME}] mutation blocked by safety guard. Set ${RUN_MUTATION_ENV}=true to enable mutations.`
      )
    }
    assertScriptMutationAllowed({
      scriptName: SCRIPT_NAME,
      envVar: ALLOW_MUTATION_ENV,
    })
  }

  if (args.limit && args.limit > HARD_CAP) {
    throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap (max ${HARD_CAP})`)
  }

  console.log(`[${SCRIPT_NAME}] ${args.dryRun ? 'DRY RUN' : 'MUTATION'} starting`)
  if (args.limit) {
    console.log(`[${SCRIPT_NAME}] limit=${args.limit}`)
  }

  const shortLinks = await fetchShortLinks(supabase, args.limit)
  console.log(`[${SCRIPT_NAME}] candidates=${shortLinks.length}`)

  const rows: AuditRow[] = []
  let healthy = 0
  let recoverable = 0
  let unrecoverable = 0
  let reissued = 0
  let resendSent = 0
  let resendSkippedRecent = 0
  let failureCount = 0
  const failurePreview: string[] = []

  for (const link of shortLinks) {
    let row: AuditRow = {
      short_link_id: link.id,
      short_code: link.short_code,
      destination_url_before: link.destination_url,
      destination_url_after: null,
      classification: 'unrecoverable',
      reason_code: 'unknown',
      table_booking_id: null,
      customer_id: null,
      resend_status: 'not_attempted',
      resend_detail: null,
    }

    try {
      const parsedUrl = parseHttpUrl(link.destination_url)
      const tablePaymentLink = parsedUrl ? parseTablePaymentLinkFromUrl(parsedUrl) : null
      if (!tablePaymentLink) {
        row.reason_code = 'invalid_destination_url'
        row.classification = 'unrecoverable'
        unrecoverable += 1
        rows.push(row)
        continue
      }

      const preview = await getTablePaymentPreviewByRawToken(supabase, tablePaymentLink.rawToken)

      if (preview.state === 'ready') {
        row.classification = 'healthy'
        row.reason_code = 'ready'
        row.table_booking_id = preview.tableBookingId
        row.customer_id = preview.customerId
        healthy += 1
        rows.push(row)
        continue
      }

      if (preview.reason !== 'invalid_token') {
        row.classification = 'unrecoverable'
        row.reason_code = preview.reason || 'unknown_blocked_reason'
        unrecoverable += 1
        rows.push(row)
        continue
      }

      const metadata = toMetadataRecord(link.metadata)
      const tableBookingId = asNonEmptyString(metadata.table_booking_id)
      const customerId = asNonEmptyString(metadata.customer_id)
      row.table_booking_id = tableBookingId
      row.customer_id = customerId

      if (!tableBookingId || !customerId) {
        row.classification = 'unrecoverable'
        row.reason_code = 'missing_recovery_metadata'
        unrecoverable += 1
        rows.push(row)
        continue
      }

      const booking = await loadBooking(supabase, tableBookingId)
      if (!booking) {
        row.classification = 'unrecoverable'
        row.reason_code = 'booking_not_found'
        unrecoverable += 1
        rows.push(row)
        continue
      }

      if (booking.customer_id !== customerId) {
        row.classification = 'unrecoverable'
        row.reason_code = 'token_customer_mismatch'
        unrecoverable += 1
        rows.push(row)
        continue
      }

      if (booking.status !== 'pending_payment') {
        row.classification = 'unrecoverable'
        row.reason_code = 'booking_not_pending_payment'
        unrecoverable += 1
        rows.push(row)
        continue
      }

      if (hasHoldExpired(booking.hold_expires_at)) {
        row.classification = 'unrecoverable'
        row.reason_code = 'hold_expired'
        unrecoverable += 1
        rows.push(row)
        continue
      }

      row.classification = args.dryRun ? 'recoverable' : 'reissued'
      row.reason_code = 'invalid_token_recoverable'
      recoverable += 1

      if (args.dryRun) {
        rows.push(row)
        continue
      }

      const replacementToken = await createTablePaymentToken(supabase, {
        customerId,
        tableBookingId,
        holdExpiresAt: booking.hold_expires_at as string,
        appBaseUrl,
      })

      const nowIso = new Date().toISOString()
      const reissueCountRaw = metadata.reissue_count
      const previousReissueCount =
        typeof reissueCountRaw === 'number' && Number.isFinite(reissueCountRaw) && reissueCountRaw >= 0
          ? Math.floor(reissueCountRaw)
          : 0
      const nextReissueCount = previousReissueCount + 1

      const { error: updateError } = await (supabase.from('short_links') as any)
        .update({
          destination_url: replacementToken.url,
          metadata: {
            ...metadata,
            guest_link_kind: 'table_payment',
            guest_action_type: 'payment',
            table_booking_id: tableBookingId,
            customer_id: customerId,
            reissue_count: nextReissueCount,
            last_reissued_at: nowIso,
          },
          updated_at: nowIso,
        })
        .eq('id', link.id)

      if (updateError) {
        row.classification = 'reissue_failed'
        row.reason_code = 'short_link_update_failed'
        failureCount += 1
        failurePreview.push(`${link.short_code}:short_link_update_failed`)
        rows.push(row)
        continue
      }

      row.destination_url_after = replacementToken.url
      row.classification = 'reissued'
      row.reason_code = 'reissued'
      reissued += 1

      const thresholdIso = new Date(Date.now() - RESEND_DEDUPE_WINDOW_MS).toISOString()
      const recentMessages = await loadRecentOutboundMessages(supabase, customerId, thresholdIso)
      if (hasRecentPendingPaymentSms(recentMessages, tableBookingId)) {
        row.resend_status = 'skipped_recent_pending_payment_sms'
        row.resend_detail = `pending-payment SMS already sent since ${thresholdIso}`
        resendSkippedRecent += 1
        rows.push(row)
        continue
      }

      const resendResult = await sendTableBookingCreatedSmsIfAllowed(supabase, {
        customerId,
        normalizedPhone: '',
        bookingResult: {
          state: 'pending_payment',
          table_booking_id: tableBookingId,
          party_size: Math.max(1, Number(booking.party_size ?? 1)),
          start_datetime: booking.start_datetime || undefined,
          status: booking.status || undefined,
          hold_expires_at: booking.hold_expires_at || undefined,
        },
        nextStepUrl: replacementToken.url,
      })

      if (resendResult.sms === null) {
        row.resend_status = 'skipped_not_sendable'
        row.resend_detail = 'customer not sendable (missing phone or sms inactive)'
      } else if (resendResult.sms.success) {
        row.resend_status = 'sent'
        row.resend_detail = resendResult.scheduledFor
          ? `scheduled_for=${resendResult.scheduledFor}`
          : 'sent_or_logging_failed'
        resendSent += 1
      } else {
        row.resend_status = 'failed'
        row.resend_detail = resendResult.sms.code || 'send_failed'
        failureCount += 1
        failurePreview.push(`${link.short_code}:resend_failed`)
      }

      rows.push(row)
    } catch (error) {
      row.classification = row.classification === 'recoverable' ? 'reissue_failed' : 'unrecoverable'
      row.reason_code = 'processing_error'
      row.resend_status = row.resend_status === 'not_attempted' ? 'failed' : row.resend_status
      row.resend_detail = error instanceof Error ? error.message : String(error)
      failureCount += 1
      failurePreview.push(`${link.short_code}:processing_error`)
      rows.push(row)
    }
  }

  const report = {
    script: SCRIPT_NAME,
    mode: args.dryRun ? 'dry-run' : 'mutation',
    ran_at: new Date().toISOString(),
    limit: args.limit,
    summary: {
      scanned: shortLinks.length,
      healthy,
      recoverable,
      unrecoverable,
      reissued,
      resend_sent: resendSent,
      resend_skipped_recent: resendSkippedRecent,
      failure_count: failureCount,
    },
    rows,
  }

  const reportDir = path.resolve(process.cwd(), 'output', 'reports')
  await fs.mkdir(reportDir, { recursive: true })
  const timestamp = new Date().toISOString().replaceAll(':', '-')
  const reportPath = path.join(reportDir, `repair-table-payment-short-links-${timestamp}.json`)
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')

  console.log(
    `[${SCRIPT_NAME}] completed: scanned=${shortLinks.length}, healthy=${healthy}, recoverable=${recoverable}, unrecoverable=${unrecoverable}, reissued=${reissued}, failures=${failureCount}`
  )
  console.log(`[${SCRIPT_NAME}] report=${reportPath}`)

  assertScriptCompletedWithoutFailures({
    scriptName: SCRIPT_NAME,
    failureCount,
    failures: failurePreview,
  })
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
