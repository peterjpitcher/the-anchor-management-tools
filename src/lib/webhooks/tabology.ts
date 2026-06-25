import crypto from 'crypto'
import type { UpsertCashupSessionDTO } from '@/types/cashing-up'
import { toLocalIsoDate } from '@/lib/dateUtils'

/**
 * Tabology (rposcloud) EPOS webhook helpers.
 *
 * Tabology POSTs an envelope { id, type, created_at, data } to a single endpoint,
 * signing the raw body with HMAC-SHA256 (account signing secret) in the `Signature`
 * header. Payload field sets are documented as examples only, so the parsing here
 * is deliberately defensive.
 */

export interface TabologyWebhookEnvelope {
  id?: string
  type?: string
  created_at?: string
  data?: Record<string, unknown>
}

export interface CashupRanData {
  id?: number | string
  venue_id?: number | string
  from?: string
  to?: string
  ran_at?: string
  ran_by?: string
  gross_sales?: number
  payments?: Record<string, { expected?: number; actual?: number }> | unknown
  closing_cash?: { expected?: number; actual?: number; variance?: number }
  plan?: { meta?: { date?: string; venue_name?: string } }
  warnings?: unknown[]
}

// --- Signature verification ---------------------------------------------------

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  try {
    return crypto.timingSafeEqual(ab, bb)
  } catch {
    return false
  }
}

/**
 * Verifies a Tabology webhook signature against the raw request body.
 * The header encoding (hex vs base64) is undocumented, so both are accepted.
 * An optional `sha256=` prefix is tolerated.
 */
export function verifyTabologySignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string | null | undefined
): boolean {
  if (!signatureHeader || !secret) return false
  const provided = signatureHeader.trim().replace(/^sha256=/i, '')
  if (!provided) return false

  const hex = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const base64 = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')

  return timingSafeEqualStr(provided, hex) || timingSafeEqualStr(provided, base64)
}

// --- cashup.ran -> cash-up session DTO ---------------------------------------

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  stripe: 'Stripe',
}

function methodLabel(code: string): string {
  const lower = code.toLowerCase()
  return METHOD_LABELS[lower] ?? code.charAt(0).toUpperCase() + code.slice(1).toLowerCase()
}

function toNumber(value: unknown): number {
  const n = typeof value === 'string' ? parseFloat(value) : typeof value === 'number' ? value : NaN
  return Number.isFinite(n) ? n : 0
}

/**
 * Resolves the trading day (Europe/London) for the cash-up.
 * Prefers the EPOS's own trading date (`plan.meta.date`), else the London date of
 * the period start (`from`), falling back to `to`/`ran_at`.
 */
export function deriveSessionDate(data: CashupRanData): string | null {
  const metaDate = data.plan?.meta?.date
  if (typeof metaDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(metaDate)) {
    return metaDate
  }

  const source = data.from || data.to || data.ran_at
  if (!source) return null

  const d = new Date(source)
  if (Number.isNaN(d.getTime())) return null

  return toLocalIsoDate(d)
}

/**
 * Maps the EPOS `payments` object to per-method breakdowns.
 * `expected` -> expected_amount (till expectation), `actual` -> counted_amount
 * (till's recorded actual). Any method present is included, not just cash/card.
 */
export function buildPaymentBreakdowns(
  payments: CashupRanData['payments']
): UpsertCashupSessionDTO['paymentBreakdowns'] {
  if (!payments || typeof payments !== 'object' || Array.isArray(payments)) return []

  const breakdowns: UpsertCashupSessionDTO['paymentBreakdowns'] = []
  for (const [method, value] of Object.entries(payments as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const v = value as { expected?: unknown; actual?: unknown }
    breakdowns.push({
      paymentTypeCode: method.toUpperCase(),
      paymentTypeLabel: methodLabel(method),
      expectedAmount: toNumber(v.expected),
      countedAmount: toNumber(v.actual),
    })
  }
  return breakdowns
}

export function buildProvenanceNote(data: CashupRanData): string {
  const parts: string[] = []
  if (data.id != null) parts.push(`EPOS cash-up #${data.id}`)
  if (data.ran_by) parts.push(`run by ${data.ran_by}`)
  if (data.ran_at) parts.push(`at ${data.ran_at}`)
  const provenance = parts.length ? parts.join(' · ') : 'Imported from EPOS'
  return `Auto-filled from Tabology EPOS — ${provenance}. Review and approve.`
}

export type MapCashupReason = 'missing_or_invalid_date' | 'no_payment_methods'

export interface MapCashupResult {
  ok: boolean
  reason?: MapCashupReason
  dto?: UpsertCashupSessionDTO
}

/**
 * Builds the cash-up session DTO from a cashup.ran payload. The session is created
 * as `submitted` (pre-filled for a manager to sign off). Cash reconciliation only —
 * no sales mix, no per-denomination counts (the EPOS does not provide them).
 */
export function mapCashupRanToDto(data: CashupRanData, siteId: string): MapCashupResult {
  const sessionDate = deriveSessionDate(data)
  if (!sessionDate) return { ok: false, reason: 'missing_or_invalid_date' }

  const paymentBreakdowns = buildPaymentBreakdowns(data.payments)
  if (paymentBreakdowns.length === 0) return { ok: false, reason: 'no_payment_methods' }

  return {
    ok: true,
    dto: {
      siteId,
      sessionDate,
      status: 'submitted',
      notes: buildProvenanceNote(data),
      paymentBreakdowns,
      cashCounts: [],
    },
  }
}
