'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimiters } from '@/lib/rate-limit'
import { headers } from 'next/headers'
import { sendSMS } from '@/lib/twilio'
import { logger } from '@/lib/logger'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { ensureCustomerForPhone, resolveCustomerIdForSms } from '@/lib/sms/customers'
import { sendBulkSms } from '@/lib/sms/bulk'
import { buildSendSmsMetadata, type SendSmsMetadataInput } from '@/lib/sms/metadata'

type SendSmsParams = SendSmsMetadataInput & {
  to: string
  body: string
  bookingId?: string
  customerId?: string
}

export async function sendOTPMessage(params: { phoneNumber: string; message: string; customerId?: string }) {
  try {
    const { phoneNumber, message, customerId } = params

    const supabase = createAdminClient()
    let resolvedCustomerId = customerId ?? undefined

    if (!resolvedCustomerId) {
      const ensured = await ensureCustomerForPhone(supabase, phoneNumber)
      resolvedCustomerId = ensured.customerId ?? undefined
    }

    const result = await sendSMS(phoneNumber, message, {
      customerId: resolvedCustomerId,
      metadata: { context: 'otp' },
      createCustomerIfMissing: false // Don't create customer for OTP if not found
    })

    if (!result.success) {
      throw new Error(result.error || 'Failed to send OTP SMS')
    }

    return { success: true, messageSid: result.sid }
  } catch (error) {
    console.error('Failed to send OTP SMS:', error)
    throw error
  }
}

export async function sendSms(params: SendSmsParams) {
  try {
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
    const { customerId } = await resolveCustomerIdForSms(supabase, {
      bookingId: params.bookingId,
      customerId: params.customerId,
      to: params.to
    })

    const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
    const messageBody = ensureReplyInstruction(params.body, supportPhone)
    const metadata = buildSendSmsMetadata(params)

    // Use the enhanced sendSMS which handles logging automatically
    const result = await sendSMS(params.to, messageBody, {
      customerId: customerId ?? undefined,
      metadata,
      createCustomerIfMissing: true
    })

    if (!result.success) {
      return { error: result.error || 'Failed to send SMS' }
    }

    return {
      success: true,
      messageSid: result.sid,
      sid: result.sid,
      messageId: result.messageId ?? undefined,
      // We don't have the DB ID immediately here because logging is async in sendSMS,
      // but the caller mostly needs success/sid.
      customerId: customerId ?? undefined
    }
  } catch (error) {
    console.error('Failed to send SMS:', error)
    return { error: 'Failed to send SMS' }
  }
}

export async function sendBulkSMSAsync(customerIds: string[], message: string) {
  try {
    const result = await sendBulkSms({
      customerIds,
      message,
      bulkJobId: 'unified'
    })

    if (!result.success) {
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
