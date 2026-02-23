import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { createTablePaymentToken, getTablePaymentPreviewByRawToken } from '@/lib/table-bookings/bookings'
import { parseTablePaymentLinkFromUrl } from '@/lib/table-bookings/payment-link'
import {
  getCityFromHeaders,
  getCountryFromHeaders,
  getRegionFromHeaders,
  parseQueryParams,
  parseUserAgent,
} from '@/lib/user-agent-parser'

const FALLBACK_REDIRECT_URL = 'https://www.the-anchor.pub'
const MISSING_RELATION_CODE = '42P01'
let loggedMissingAliasTable = false

type ShortLinkRow = {
  id: string
  short_code: string
  destination_url: string
  metadata: Record<string, unknown> | null
  expires_at: string | null
}

function isMissingRelationError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === MISSING_RELATION_CODE
}

function normalizeShortCode(raw: string | undefined | null): string | null {
  if (!raw) return null
  try {
    const decoded = decodeURIComponent(raw)
    const normalized = decoded.trim().toLowerCase()
    if (!normalized) return null

    if (!/^[a-z0-9-]+$/.test(normalized)) return null
    return normalized
  } catch {
    return null
  }
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

function resolveAppBaseUrl(request: NextRequest): string {
  const candidate = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin || FALLBACK_REDIRECT_URL
  return candidate.replace(/\/+$/, '')
}

function extractClientIp(request: NextRequest): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for')
  const firstForwarded = forwardedFor?.split(',')[0]?.trim()
  const candidate = firstForwarded || request.headers.get('x-real-ip') || (request as any).ip

  if (!candidate) return null

  const ipv4WithPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/)
  const ip = (ipv4WithPort ? ipv4WithPort[1] : candidate).trim()

  if (!ip) return null
  if (!/^[0-9a-fA-F:.]+$/.test(ip)) return null
  return ip
}

function toMetadataRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) }
  }
  return {}
}

function getMetadataString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getMetadataCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed)
    }
  }
  return 0
}

function buildBlockedTablePaymentUrl(
  request: NextRequest,
  rawToken: string,
  reason: string
): string {
  return new URL(
    `/g/${encodeURIComponent(rawToken)}/table-payment?state=blocked&reason=${encodeURIComponent(reason)}`,
    request.url
  ).toString()
}

async function attemptTablePaymentShortLinkRecovery(params: {
  request: NextRequest
  supabase: any
  resolvedLink: ShortLinkRow
  rawToken: string
  shortCode: string
}): Promise<
  | {
    state: 'reissued'
    destinationUrl: string
    tableBookingId: string
    reasonCode: 'invalid_token'
    reissueCount: number
  }
  | {
    state: 'unrecoverable'
    tableBookingId: string | null
    reasonCode: string
  }
> {
  const metadata = toMetadataRecord(params.resolvedLink.metadata)
  const tableBookingId = getMetadataString(metadata.table_booking_id)
  const customerId = getMetadataString(metadata.customer_id)

  if (!tableBookingId || !customerId) {
    return {
      state: 'unrecoverable',
      tableBookingId: tableBookingId || null,
      reasonCode: 'missing_recovery_metadata',
    }
  }

  const { data: booking, error: bookingError } = await (params.supabase.from('table_bookings') as any)
    .select('id, customer_id, status, hold_expires_at')
    .eq('id', tableBookingId)
    .maybeSingle()

  if (bookingError) {
    return {
      state: 'unrecoverable',
      tableBookingId,
      reasonCode: 'booking_lookup_failed',
    }
  }

  if (!booking) {
    return {
      state: 'unrecoverable',
      tableBookingId,
      reasonCode: 'booking_not_found',
    }
  }

  if (booking.customer_id !== customerId) {
    return {
      state: 'unrecoverable',
      tableBookingId,
      reasonCode: 'token_customer_mismatch',
    }
  }

  if (booking.status !== 'pending_payment') {
    return {
      state: 'unrecoverable',
      tableBookingId,
      reasonCode: 'booking_not_pending_payment',
    }
  }

  const holdExpiry = booking.hold_expires_at ? Date.parse(booking.hold_expires_at) : Number.NaN
  if (!Number.isFinite(holdExpiry) || holdExpiry <= Date.now()) {
    return {
      state: 'unrecoverable',
      tableBookingId,
      reasonCode: 'hold_expired',
    }
  }

  let replacementToken: Awaited<ReturnType<typeof createTablePaymentToken>>
  try {
    replacementToken = await createTablePaymentToken(params.supabase as any, {
      customerId,
      tableBookingId,
      holdExpiresAt: booking.hold_expires_at,
      appBaseUrl: resolveAppBaseUrl(params.request),
    })
  } catch {
    return {
      state: 'unrecoverable',
      tableBookingId,
      reasonCode: 'token_reissue_failed',
    }
  }

  const nowIso = new Date().toISOString()
  const reissueCount = getMetadataCount(metadata.reissue_count) + 1
  const updatedMetadata: Record<string, unknown> = {
    ...metadata,
    guest_link_kind: 'table_payment',
    guest_action_type: 'payment',
    table_booking_id: tableBookingId,
    customer_id: customerId,
    reissue_count: reissueCount,
    last_reissued_at: nowIso,
  }

  const { error: updateError } = await (params.supabase.from('short_links') as any)
    .update({
      destination_url: replacementToken.url,
      metadata: updatedMetadata,
      updated_at: nowIso,
    })
    .eq('id', params.resolvedLink.id)

  if (updateError) {
    return {
      state: 'unrecoverable',
      tableBookingId,
      reasonCode: 'short_link_update_failed',
    }
  }

  logger.info('short_link_table_payment_auto_reissued', {
    metadata: {
      short_code: params.resolvedLink.short_code || params.shortCode,
      table_booking_id: tableBookingId,
      reason_code: 'invalid_token',
      reissue_count: reissueCount,
    }
  })

  return {
    state: 'reissued',
    destinationUrl: replacementToken.url,
    tableBookingId,
    reasonCode: 'invalid_token',
    reissueCount,
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code: rawCode } = await params
    const shortCode = normalizeShortCode(rawCode)

    if (!shortCode) {
      return NextResponse.redirect(FALLBACK_REDIRECT_URL)
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase configuration')
      return NextResponse.redirect(FALLBACK_REDIRECT_URL)
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: link, error } = await supabase
      .from('short_links')
      .select('*')
      .eq('short_code', shortCode)
      .maybeSingle()

    if (error) {
      console.error('Short link lookup error:', shortCode, error)
      return NextResponse.redirect(FALLBACK_REDIRECT_URL)
    }

    let resolvedLink = (link || null) as ShortLinkRow | null
    let resolvedViaAlias = false

    if (!resolvedLink) {
      const { data: alias, error: aliasError } = await supabase
        .from('short_link_aliases')
        .select('short_link_id')
        .eq('alias_code', shortCode)
        .maybeSingle()

      if (aliasError) {
        if (isMissingRelationError(aliasError)) {
          if (!loggedMissingAliasTable) {
            console.warn('Short link alias table missing. Apply latest Supabase migrations to enable aliases.')
            loggedMissingAliasTable = true
          }
          return NextResponse.redirect(FALLBACK_REDIRECT_URL)
        }
        console.error('Short link alias lookup error:', shortCode, aliasError)
        return NextResponse.redirect(FALLBACK_REDIRECT_URL)
      }

      if (!alias) {
        return NextResponse.redirect(FALLBACK_REDIRECT_URL)
      }

      const { data: targetLink, error: targetError } = await supabase
        .from('short_links')
        .select('*')
        .eq('id', alias.short_link_id)
        .maybeSingle()

      if (targetError) {
        console.error('Short link alias target lookup error:', shortCode, targetError)
        return NextResponse.redirect(FALLBACK_REDIRECT_URL)
      }

      if (!targetLink) {
        return NextResponse.redirect(FALLBACK_REDIRECT_URL)
      }

      resolvedLink = targetLink as ShortLinkRow
      resolvedViaAlias = true
    }

    if (resolvedLink.expires_at && new Date(resolvedLink.expires_at) < new Date()) {
      return NextResponse.redirect(FALLBACK_REDIRECT_URL)
    }

    let redirectDestinationUrl = resolvedLink.destination_url
    const parsedDestination = parseHttpUrl(resolvedLink.destination_url)
    const tablePaymentLink = parsedDestination ? parseTablePaymentLinkFromUrl(parsedDestination) : null

    if (tablePaymentLink) {
      try {
        const preview = await getTablePaymentPreviewByRawToken(supabase, tablePaymentLink.rawToken)
        if (preview.state !== 'ready') {
          if (preview.reason === 'invalid_token') {
            const recovery = await attemptTablePaymentShortLinkRecovery({
              request,
              supabase,
              resolvedLink,
              rawToken: tablePaymentLink.rawToken,
              shortCode,
            })

            if (recovery.state === 'reissued') {
              redirectDestinationUrl = recovery.destinationUrl
            } else {
              logger.warn('short_link_table_payment_reissue_unrecoverable', {
                metadata: {
                  short_code: resolvedLink.short_code || shortCode,
                  table_booking_id: recovery.tableBookingId,
                  reason_code: recovery.reasonCode,
                }
              })
              redirectDestinationUrl = buildBlockedTablePaymentUrl(request, tablePaymentLink.rawToken, 'invalid_token')
            }
          } else {
            redirectDestinationUrl = buildBlockedTablePaymentUrl(
              request,
              tablePaymentLink.rawToken,
              preview.reason || 'internal_error'
            )
          }
        }
      } catch (error) {
        logger.error('Failed to evaluate table payment short-link destination state', {
          error: error instanceof Error ? error : new Error(String(error)),
          metadata: {
            short_code: resolvedLink.short_code || shortCode,
          }
        })
        redirectDestinationUrl = buildBlockedTablePaymentUrl(request, tablePaymentLink.rawToken, 'internal_error')
      }
    }

    try {
      const userAgent = request.headers.get('user-agent')
      const { deviceType, browser, os } = parseUserAgent(userAgent)
      const utmParams = parseQueryParams(request.url)
      const ipAddress = extractClientIp(request)

      const { error: clickInsertError } = await supabase
        .from('short_link_clicks')
        .insert({
          short_link_id: resolvedLink.id,
          user_agent: userAgent,
          referrer: request.headers.get('referer'),
          ip_address: ipAddress,
          country: getCountryFromHeaders(request.headers),
          city: getCityFromHeaders(request.headers),
          region: getRegionFromHeaders(request.headers),
          device_type: deviceType,
          browser,
          os,
          utm_source: utmParams.utm_source,
          utm_medium: utmParams.utm_medium,
          utm_campaign: utmParams.utm_campaign,
          metadata: resolvedViaAlias ? { alias_code: shortCode } : {}
        })
      if (clickInsertError) {
        throw clickInsertError
      }

      if (deviceType !== 'bot') {
        const { error: incrementError } = await (supabase as any).rpc('increment_short_link_clicks', {
          p_short_link_id: resolvedLink.id
        })
        if (incrementError) {
          throw incrementError
        }
      }
    } catch (err) {
      console.error('Error tracking click:', err)
    }

    return NextResponse.redirect(redirectDestinationUrl)
  } catch (error) {
    console.error('Redirect error:', error)
    return NextResponse.redirect(FALLBACK_REDIRECT_URL)
  }
}
