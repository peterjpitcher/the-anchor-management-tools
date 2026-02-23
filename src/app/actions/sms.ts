'use server'

import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimiters } from '@/lib/rate-limit'
import { headers } from 'next/headers'
import { sendSMS } from '@/lib/twilio'
import { logger } from '@/lib/logger'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { ensureCustomerForPhone, resolveCustomerIdForSms } from '@/lib/sms/customers'
import { sendBulkSms } from '@/lib/sms/bulk'
import { parseTablePaymentLinkFromUrl } from '@/lib/table-bookings/payment-link'
import { getTablePaymentPreviewByRawToken } from '@/lib/table-bookings/bookings'
import {
  buildBulkSmsDispatchKey,
  normalizeBulkRecipientIds,
  validateBulkSmsRecipientCount
} from '@/lib/sms/bulk-dispatch-key'
import { buildSendSmsMetadata, type SendSmsMetadataInput } from '@/lib/sms/metadata'
import { checkUserPermission } from './rbac'

type SendSmsParams = SendSmsMetadataInput & {
  to: string
  body: string
  bookingId?: string
  customerId?: string
}

const URL_TOKEN_REGEX = /https?:\/\/\S+/gi
const TRAILING_PUNCTUATION = new Set(['.', ',', '!', '?', ';', ':', ')', ']', '}', '"', "'", '>'])

type TablePaymentLinkInMessage = {
  url: string
  rawToken: string
}

function extractBulkSafetyAbortCode(errorMessage: string): string | null {
  const match = errorMessage.match(/Bulk SMS aborted due to safety failure \(([^)]+)\):/)
  return match?.[1] ?? null
}

function splitUrlToken(rawToken: string): string {
  let cleanUrl = rawToken

  while (cleanUrl.length > 0) {
    const char = cleanUrl[cleanUrl.length - 1]
    if (!TRAILING_PUNCTUATION.has(char)) {
      break
    }

    if (char === ')') {
      const opens = (cleanUrl.match(/\(/g) || []).length
      const closes = (cleanUrl.match(/\)/g) || []).length
      if (closes <= opens) {
        break
      }
    }

    cleanUrl = cleanUrl.slice(0, -1)
  }

  return cleanUrl
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

function extractTablePaymentLinksFromMessage(body: string): TablePaymentLinkInMessage[] {
  if (!body) {
    return []
  }

  const rawMatches = Array.from(body.matchAll(URL_TOKEN_REGEX)).map((match) => match[0])
  if (rawMatches.length === 0) {
    return []
  }

  const dedupe = new Set<string>()
  const links: TablePaymentLinkInMessage[] = []

  for (const rawMatch of rawMatches) {
    const cleanUrl = splitUrlToken(rawMatch)
    const parsed = parseHttpUrl(cleanUrl)
    if (!parsed) {
      continue
    }

    const tablePaymentLink = parseTablePaymentLinkFromUrl(parsed)
    if (!tablePaymentLink) {
      continue
    }

    const dedupeKey = `${cleanUrl}::${tablePaymentLink.rawToken}`
    if (dedupe.has(dedupeKey)) {
      continue
    }
    dedupe.add(dedupeKey)

    links.push({
      url: cleanUrl,
      rawToken: tablePaymentLink.rawToken
    })
  }

  return links
}

async function findBlockedManualTablePaymentLink(
  supabase: ReturnType<typeof createAdminClient>,
  body: string
): Promise<{ url: string; reason: string } | null> {
  const links = extractTablePaymentLinksFromMessage(body)
  if (links.length === 0) {
    return null
  }

  for (const link of links) {
    try {
      const preview = await getTablePaymentPreviewByRawToken(supabase, link.rawToken)
      if (preview.state === 'ready') {
        continue
      }
      return {
        url: link.url,
        reason: preview.reason || 'invalid_token'
      }
    } catch (error) {
      logger.warn('manual_sms_blocked_invalid_payment_link', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: {
          payment_link_url: link.url,
          reason_code: 'validation_unavailable',
        }
      })
      return {
        url: link.url,
        reason: 'validation_unavailable'
      }
    }
  }

  return null
}

async function ensureBulkRateLimitNotExceeded() {
  const headersList = await headers()
  const ip = headersList.get('x-forwarded-for') || headersList.get('x-real-ip') || 'unknown'
  const { NextRequest } = await import('next/server')
  const mockReq = new NextRequest('http://localhost', {
    headers: { 'x-forwarded-for': ip }
  })

  const rateLimitResponse = await rateLimiters.bulk(mockReq)
  if (rateLimitResponse) {
    return 'Too many bulk SMS operations. Please wait before sending more bulk messages.'
  }

  return null
}

export async function sendOTPMessage(params: { phoneNumber: string; message: string; customerId?: string }) {
  const { phoneNumber, message, customerId } = params
  let resolvedCustomerId = customerId ?? undefined

  try {
    const supabase = createAdminClient()

    if (!resolvedCustomerId) {
      const ensured = await ensureCustomerForPhone(supabase, phoneNumber)
      if (ensured.resolutionError) {
        logger.error('OTP SMS blocked because customer resolution safety check failed', {
          metadata: {
            phoneNumber,
            reason: ensured.resolutionError
          }
        })
        throw new Error('SMS blocked by customer safety check')
      }

      resolvedCustomerId = ensured.customerId ?? undefined
      if (!resolvedCustomerId) {
        logger.error('OTP SMS blocked because customer resolution returned no customer', {
          metadata: { phoneNumber }
        })
        throw new Error('SMS blocked by customer safety check')
      }
    }

    const otpStage = createHash('sha256').update(message).digest('hex').slice(0, 16)

    const result = await sendSMS(phoneNumber, message, {
      customerId: resolvedCustomerId,
      metadata: {
        context: 'otp',
        template_key: 'otp_message',
        trigger_type: 'otp_message',
        stage: otpStage
      },
      createCustomerIfMissing: false // Don't create customer for OTP if not found
    })

    const otpCode = typeof (result as any)?.code === 'string' ? (result as any).code : undefined
    const otpLogFailure = (result as any)?.logFailure === true || otpCode === 'logging_failed'

    if (otpLogFailure) {
      // Fail-safe: the OTP SMS may have been delivered but outbound logging failed. Do not throw,
      // or clients may retry and amplify duplicate OTP sends.
      logger.error('OTP SMS sent but outbound message logging failed', {
        metadata: {
          customerId: resolvedCustomerId ?? null,
          code: otpCode ?? null,
        },
      })
    } else if (!result.success) {
      throw new Error(result.error || 'Failed to send OTP SMS')
    }

    return {
      success: true,
      messageSid: result.sid,
      code: otpCode,
      logFailure: otpLogFailure,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message !== 'SMS blocked by customer safety check') {
      logger.error('Failed to send OTP SMS', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: {
          phoneNumber,
          customerId: resolvedCustomerId ?? null,
        },
      })
    }
    throw error
  }
}

export async function sendSms(params: SendSmsParams) {
  try {
    const hasPermission = await checkUserPermission('messages', 'send')
    if (!hasPermission) {
      return { error: 'Insufficient permissions to send messages' }
    }

    const headersList = await headers()
    const ip = headersList.get('x-forwarded-for') || headersList.get('x-real-ip') || 'unknown'
    const { NextRequest } = await import('next/server')
    const mockReq = new NextRequest('http://localhost', {
      headers: { 'x-forwarded-for': ip }
    })

    const rateLimitResponse = await rateLimiters.sms(mockReq)
    if (rateLimitResponse) {
      return { error: 'Too many SMS requests. Please wait before sending more messages.' }
    }

    const supabase = createAdminClient()
    const { customerId, resolutionError } = await resolveCustomerIdForSms(supabase, {
      bookingId: params.bookingId,
      customerId: params.customerId,
      to: params.to
    })

    if (resolutionError) {
      logger.error('SMS blocked because recipient context lookup failed', {
        metadata: {
          to: params.to,
          bookingId: params.bookingId ?? null,
          reason: resolutionError
        }
      })
      return { error: 'Failed SMS recipient safety check' }
    }

    const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
    const messageBody = ensureReplyInstruction(params.body, supportPhone)
    const metadata = {
      ...(buildSendSmsMetadata(params) ?? {})
    } as Record<string, unknown>

    if (metadata.template_key === undefined) {
      metadata.template_key = 'manual_sms'
    }
    if (metadata.trigger_type === undefined) {
      metadata.trigger_type = 'manual_sms'
    }
    if (metadata.stage === undefined) {
      metadata.stage = createHash('sha256').update(messageBody).digest('hex').slice(0, 16)
    }

    const blockedPaymentLink = await findBlockedManualTablePaymentLink(supabase, params.body)
    if (blockedPaymentLink) {
      logger.warn('manual_sms_blocked_invalid_payment_link', {
        metadata: {
          to: params.to,
          bookingId: params.bookingId ?? null,
          customerId: customerId ?? params.customerId ?? null,
          payment_link_url: blockedPaymentLink.url,
          reason_code: blockedPaymentLink.reason,
        }
      })
      return { error: `Cannot send SMS because a payment link is unavailable (${blockedPaymentLink.reason}).` }
    }

    // Use the enhanced sendSMS which handles logging automatically
    const result = await sendSMS(params.to, messageBody, {
      customerId: customerId ?? undefined,
      metadata,
      createCustomerIfMissing: true
    })

    const smsCode = typeof (result as any)?.code === 'string' ? (result as any).code : undefined
    const smsLogFailure = (result as any)?.logFailure === true || smsCode === 'logging_failed'

    if (smsLogFailure) {
      // Fail-safe: the SMS may have been delivered but outbound logging failed. Do not return an
      // error, or the UI may retry and amplify duplicate sends under degraded persistence.
      logger.error('SMS sent but outbound message logging failed', {
        metadata: {
          to: params.to,
          bookingId: params.bookingId ?? null,
          customerId: customerId ?? null,
          code: smsCode ?? null,
        },
      })
    } else if (!result.success) {
      return { error: result.error || 'Failed to send SMS' }
    }

    return {
      success: true,
      messageSid: result.sid,
      sid: result.sid,
      messageId: result.messageId ?? undefined,
      code: smsCode,
      logFailure: smsLogFailure,
      // We don't have the DB ID immediately here because logging is async in sendSMS,
      // but the caller mostly needs success/sid.
      customerId: customerId ?? undefined,
      suppressed: result.suppressed === true,
      suppressionReason: result.suppressionReason,
      deferred: result.deferred === true,
      deferredBy: result.deferredBy,
      scheduledFor: result.scheduledFor
    }
  } catch (error) {
    logger.error('Failed to send SMS action', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: {
        to: params.to,
        bookingId: params.bookingId ?? null,
        customerId: params.customerId ?? null,
      },
    })
    return { error: 'Failed to send SMS' }
  }
}

export async function sendBulkSMSAsync(customerIds: string[], message: string) {
  try {
    const hasPermission = await checkUserPermission('messages', 'send')
    if (!hasPermission) {
      return { error: 'Insufficient permissions to send messages' }
    }

    const rateLimitError = await ensureBulkRateLimitNotExceeded()
    if (rateLimitError) {
      return { error: rateLimitError }
    }

    const normalizedCustomerIds = normalizeBulkRecipientIds(customerIds)
    if (normalizedCustomerIds.length === 0) {
      return { error: 'No valid recipients to send' }
    }

    const recipientLimitError = validateBulkSmsRecipientCount(normalizedCustomerIds.length)
    if (recipientLimitError) {
      return { error: recipientLimitError }
    }

    const bulkJobId = buildBulkSmsDispatchKey({
      customerIds: normalizedCustomerIds,
      message
    })

    const result = await sendBulkSms({
      customerIds: normalizedCustomerIds,
      message,
      bulkJobId
    })

    if (!result.success) {
      const abortCode = extractBulkSafetyAbortCode(result.error)
      if (abortCode === 'logging_failed') {
        // Fail-safe: some messages may have been sent but outbound logging failed, so we must not
        // encourage retries that could amplify duplicate sends under degraded persistence.
        return {
          success: true,
          message:
            'Bulk SMS aborted because outbound message logging failed after sends may have occurred. Do not retry; please refresh and contact engineering.',
          code: abortCode,
          logFailure: true,
        }
      }
      return { error: result.error }
    }

    return {
      success: true,
      sent: result.sent,
      failed: result.failed,
      total: result.total,
      results: result.results,
      errors: result.errors
    }
  } catch (error) {
    logger.error('Error in sendBulkSMSAsync', {
      error: error as Error
    })
    return { error: 'Failed to send message' }
  }
}
