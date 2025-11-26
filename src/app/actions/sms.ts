'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimiters } from '@/lib/rate-limit'
import { headers } from 'next/headers'
import { sendSMS } from '@/lib/twilio'
import { logger } from '@/lib/logger'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { ensureCustomerForPhone, resolveCustomerIdForSms } from '@/lib/sms/customers'

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

export async function sendSms(params: { to: string; body: string; bookingId?: string; customerId?: string }) {
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

    // Use the enhanced sendSMS which handles logging automatically
    const result = await sendSMS(params.to, messageBody, {
      customerId: customerId ?? undefined,
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
    const supabase = createAdminClient()

    const { data: customers, error } = await supabase
      .from('customers')
      .select('id, mobile_number, sms_opt_in')
      .in('id', customerIds)

    if (error || !customers || customers.length === 0) {
      return { error: 'No valid customers found' }
    }

    const validCustomers = customers.filter(customer => {
      if (!customer.mobile_number) {
        logger.debug('Skipping customer with no mobile number', {
          metadata: { customerId: customer.id }
        })
        return false
      }
      if (customer.sms_opt_in !== true) {
        logger.debug('Skipping customer without SMS opt-in', {
          metadata: { customerId: customer.id }
        })
        return false
      }
      return true
    })

    if (validCustomers.length === 0) {
      return { error: 'No customers with valid mobile numbers and SMS opt-in' }
    }

    const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
    const messageWithSupportTemplate = ensureReplyInstruction(message, supportPhone)
    const results: Array<{ customerId: string; success: boolean; messageSid?: string; error?: string }> = []
    const errors: Array<{ customerId: string; error: string }> = []

    for (const customer of validCustomers) {
      try {
        const sendResult = await sendSMS(customer.mobile_number!, messageWithSupportTemplate, {
          customerId: customer.id,
          metadata: { bulk_sms: true }
        })

        if (!sendResult.success || !sendResult.sid) {
          errors.push({
            customerId: customer.id,
            error: sendResult.error || 'Failed to send message'
          })
          continue
        }

        results.push({
          customerId: customer.id,
          success: true,
          messageSid: sendResult.sid
        })
      } catch (sendError) {
        logger.error('Failed to send SMS to customer', {
          error: sendError as Error,
          metadata: { customerId: customer.id }
        })
        errors.push({
          customerId: customer.id,
          error: sendError instanceof Error ? sendError.message : 'Failed to send message'
        })
      }
    }

    return {
      success: true,
      sent: results.length,
      failed: errors.length,
      total: customerIds.length,
      results,
      errors: errors.length > 0 ? errors : undefined
    }
  } catch (error) {
    logger.error('Error in sendBulkSMSAsync', {
      error: error as Error
    })
    return { error: 'Failed to send message' }
  }
}
