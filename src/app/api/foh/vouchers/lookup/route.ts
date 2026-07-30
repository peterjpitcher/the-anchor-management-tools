import { NextRequest, NextResponse } from 'next/server'
import { requireFohVoucherPermission, getLondonDateIso } from '@/lib/foh/api-auth'
import { createRateLimiter } from '@/lib/rate-limit'
import { LOOKUP_MIN_CHARS, LOOKUP_MAX_RESULTS } from '@/lib/vouchers/constants'
import { normaliseVoucherNumberInput } from '@/lib/vouchers/numbering'
import { completedLondonDaysSince, humaniseAge } from '@/lib/vouchers/age'
import type { VoucherStatus } from '@/types/vouchers'
import { validationError, buildCustomerName } from '../shared'

// Light protection for the shared kiosk account (spec section 4, F32).
const lookupLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Too many voucher lookups. Please wait a moment and try again.'
})

// Amber "expires in N days" threshold, in London days (spec section 4).
const EXPIRING_SOON_DAYS = 7

const MS_PER_DAY = 86_400_000

function isoDateToUtcMs(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

function daysBetweenIsoDates(fromIso: string, toIso: string): number {
  return Math.round((isoDateToUtcMs(toIso) - isoDateToUtcMs(fromIso)) / MS_PER_DAY)
}

// Snapshot entries in voucher_batches.type_definitions are to_jsonb(voucher_types row),
// so they carry the same snake_case shape as the live table (F04).
type TypeInfo = {
  display_title?: string
  entitlement_html?: string
  alcohol?: boolean
  requires_booking?: boolean
  value_pence?: number | null
}

type LookupRow = {
  id: string
  voucher_number: string
  type_id: string
  status: VoucherStatus
  value_pence: number | null
  issued_at: string | null
  issued_by_name: string | null
  won_at_label: string | null
  expiry_date: string | null
  redeemed_at: string | null
  redeemed_by_name: string | null
  cancelled_at: string | null
  cancelled_reason: string | null
  replaced_by_id: string | null
  customer: { id: string; first_name: string | null; last_name: string | null } | null
  batch: { pdf_status: string; type_definitions: Record<string, TypeInfo> | null } | null
  voucher_type: TypeInfo | null
}

export async function GET(request: NextRequest) {
  const rateLimitResponse = await lookupLimiter(request)
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const auth = await requireFohVoucherPermission('view')
  if (!auth.ok) {
    return auth.response
  }

  const rawQuery = request.nextUrl.searchParams.get('q') ?? ''
  // Normalise scanner/typed input (F50), then keep only characters that can appear
  // in a canonical number so the ilike pattern is safe.
  const normalised = normaliseVoucherNumberInput(rawQuery).replace(/[^A-Z0-9-]/g, '')

  if (normalised.length < LOOKUP_MIN_CHARS) {
    return validationError(`Type at least ${LOOKUP_MIN_CHARS} characters of the voucher number`)
  }

  const { data, error } = await auth.supabase
    .from('vouchers')
    .select(
      `id, voucher_number, type_id, status, value_pence,
       issued_at, issued_by_name, won_at_label, expiry_date,
       redeemed_at, redeemed_by_name, cancelled_at, cancelled_reason, replaced_by_id,
       customer:customers!vouchers_customer_id_fkey(id, first_name, last_name),
       batch:voucher_batches!vouchers_batch_id_fkey(pdf_status, type_definitions),
       voucher_type:voucher_types!vouchers_type_id_fkey(display_title, entitlement_html, alcohol, requires_booking, value_pence)`
    )
    .ilike('voucher_number', `%${normalised}%`)
    .order('voucher_number', { ascending: true })
    .limit(LOOKUP_MAX_RESULTS)

  if (error) {
    return NextResponse.json({ error: 'Failed to look up vouchers' }, { status: 500 })
  }

  const rows = (data ?? []) as unknown as LookupRow[]

  // Replacement numbers via a second query: vouchers carries two self-FKs, and a
  // self-referencing embed is direction-ambiguous in PostgREST, so resolve by id.
  const replacementIds = rows
    .map((row) => row.replaced_by_id)
    .filter((value): value is string => Boolean(value))
  const replacementNumbers = new Map<string, string>()

  if (replacementIds.length > 0) {
    const { data: replacements, error: replacementsError } = await auth.supabase
      .from('vouchers')
      .select('id, voucher_number')
      .in('id', replacementIds)

    if (replacementsError) {
      return NextResponse.json({ error: 'Failed to look up vouchers' }, { status: 500 })
    }

    for (const replacement of (replacements ?? []) as Array<{ id: string; voucher_number: string }>) {
      replacementNumbers.set(replacement.id, replacement.voucher_number)
    }
  }

  const londonToday = getLondonDateIso()

  const items = rows.map((row) => {
    const snapshot = row.batch?.type_definitions?.[row.type_id]
    const typeInfo: TypeInfo = snapshot ?? row.voucher_type ?? {}

    // Lookup treats a past expiry as expired regardless of the nightly cron (spec 2.5/4).
    const pastExpiry =
      row.expiry_date !== null && daysBetweenIsoDates(row.expiry_date, londonToday) > 0
    const status: VoucherStatus =
      row.status === 'issued' && pastExpiry ? 'expired' : row.status

    const ageDays = row.issued_at ? completedLondonDaysSince(row.issued_at) : null
    const expiresInDays =
      row.expiry_date !== null ? daysBetweenIsoDates(londonToday, row.expiry_date) : null
    const expiringSoon =
      status === 'issued' &&
      expiresInDays !== null &&
      expiresInDays >= 0 &&
      expiresInDays <= EXPIRING_SOON_DAYS

    return {
      number: row.voucher_number,
      typeId: row.type_id,
      typeTitle: typeInfo.display_title ?? row.type_id,
      entitlementHtml: typeInfo.entitlement_html ?? '',
      status,
      storedStatus: row.status,
      ageDays,
      ageLabel: ageDays !== null ? humaniseAge(ageDays) : null,
      issuedAt: row.issued_at,
      issuedByName: row.issued_by_name,
      wonAtLabel: row.won_at_label,
      expiryDate: row.expiry_date,
      expiresInDays,
      expiringSoon,
      customer: row.customer
        ? { id: row.customer.id, name: buildCustomerName(row.customer.first_name, row.customer.last_name) }
        : null,
      alcohol: typeInfo.alcohol ?? false,
      requiresBooking: typeInfo.requires_booking ?? false,
      valuePence: row.value_pence ?? typeInfo.value_pence ?? null,
      redeemedAt: row.redeemed_at,
      redeemedByName: row.redeemed_by_name,
      cancelledAt: row.cancelled_at,
      cancelledReason: row.cancelled_reason,
      replacementNumber: row.replaced_by_id
        ? replacementNumbers.get(row.replaced_by_id) ?? null
        : null,
      batchReady: row.batch?.pdf_status === 'ready'
    }
  })

  return NextResponse.json({ success: true, data: items })
}
