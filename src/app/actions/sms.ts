'use server'

import { createAdminClient } from '@/lib/supabase/server'
import twilio from 'twilio'
import { rateLimiters } from '@/lib/rate-limit'
import { headers } from 'next/headers'
import { sendSMS } from '@/lib/twilio'
import { logger } from '@/lib/logger'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { recordOutboundSmsMessage } from '@/lib/sms/logging'
import { ensureCustomerForPhone, resolveCustomerIdForSms } from '@/lib/sms/customers'

interface TwilioMessageCreateParams {
  to: string
  body: string
  from?: string
  messagingServiceSid?: string
}


export async function sendOTPMessage(params: { phoneNumber: string; message: string; customerId?: string }) {
  try {
    const { phoneNumber, message, customerId } = params

    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      throw new Error('Twilio credentials not configured')
    }

    const supabase = createAdminClient()
    let resolvedCustomerId = customerId ?? null

    if (!resolvedCustomerId) {
      const ensured = await ensureCustomerForPhone(supabase, phoneNumber)
      resolvedCustomerId = ensured.customerId
    }

    const twilioClientInstance = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    )

    const messageParams: TwilioMessageCreateParams = {
      body: message,
      to: phoneNumber
    }

    if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
      messageParams.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID
    } else if (process.env.TWILIO_PHONE_NUMBER) {
      messageParams.from = process.env.TWILIO_PHONE_NUMBER
    } else {
      throw new Error('No Twilio sender configured')
    }

    const twilioMessage = await twilioClientInstance.messages.create(messageParams)

    if (resolvedCustomerId) {
      try {
        await recordOutboundSmsMessage({
          supabase,
          customerId: resolvedCustomerId,
          to: twilioMessage.to,
          body: message,
          sid: twilioMessage.sid,
          fromNumber: twilioMessage.from,
          twilioStatus: twilioMessage.status || 'queued',
          status: twilioMessage.status || 'queued',
          metadata: {
            context: 'otp'
          }
        })
      } catch (error) {
        console.error('Error recording OTP SMS message:', error)
      }
    } else {
      logger.debug('OTP SMS sent but no customer record could be resolved', {
        metadata: { to: phoneNumber, sid: twilioMessage.sid }
      })
    }

    return { success: true, messageSid: twilioMessage.sid }
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

    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      console.log('Skipping SMS - Twilio not configured')
      return { error: 'SMS service not configured' }
    }

    if (!process.env.TWILIO_PHONE_NUMBER && !process.env.TWILIO_MESSAGING_SERVICE_SID) {
      console.log('Skipping SMS - No phone number or messaging service configured')
      return { error: 'SMS service not configured' }
    }

    const supabase = createAdminClient()
    const { customerId } = await resolveCustomerIdForSms(supabase, {
      bookingId: params.bookingId,
      customerId: params.customerId,
      to: params.to
    })

    const twilioClientInstance = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    )

    const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
    const messageBody = ensureReplyInstruction(params.body, supportPhone)

    const messageParams: TwilioMessageCreateParams = {
      body: messageBody,
      to: params.to
    }

    if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
      messageParams.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID
    } else if (process.env.TWILIO_PHONE_NUMBER) {
      messageParams.from = process.env.TWILIO_PHONE_NUMBER
    }

    const twilioMessage = await twilioClientInstance.messages.create(messageParams)

    const messageRecordId = await recordOutboundSmsMessage({
      supabase,
      customerId,
      to: twilioMessage.to,
      body: messageBody,
      sid: twilioMessage.sid,
      fromNumber: twilioMessage.from,
      twilioStatus: twilioMessage.status || 'queued',
      status: twilioMessage.status || 'queued'
    })

    if (!messageRecordId) {
      logger.warn('SMS sent but failed to log message', {
        metadata: { to: params.to, sid: twilioMessage.sid }
      })
    }

    return {
      success: true,
      messageSid: twilioMessage.sid,
      sid: twilioMessage.sid,
      messageId: messageRecordId,
      customerId: customerId ?? undefined
    }
  } catch (error) {
    console.error('Failed to send SMS:', error)
    return { error: 'Failed to send SMS' }
  }
}

export async function sendBulkSMSAsync(customerIds: string[], message: string) {
  try {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      logger.warn('Skipping bulk SMS - Twilio not configured')
      return { error: 'SMS service not configured' }
    }

    if (!process.env.TWILIO_PHONE_NUMBER && !process.env.TWILIO_MESSAGING_SERVICE_SID) {
      logger.warn('Skipping bulk SMS - No Twilio sender configured')
      return { error: 'SMS service not configured' }
    }

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
        const messageWithSupport = messageWithSupportTemplate
        const sendResult = await sendSMS(customer.mobile_number, messageWithSupport)

        if (!sendResult.success || !sendResult.sid) {
          errors.push({
            customerId: customer.id,
            error: sendResult.error || 'Failed to send message'
          })
          continue
        }

        const messageId = await recordOutboundSmsMessage({
          supabase,
          customerId: customer.id,
          to: customer.mobile_number!,
          body: messageWithSupport,
          sid: sendResult.sid,
          fromNumber: sendResult.fromNumber ?? undefined,
          metadata: { bulk_sms: true },
          status: 'sent',
          twilioStatus: sendResult.status ?? 'queued'
        })

        if (!messageId) {
          errors.push({
            customerId: customer.id,
            error: 'SMS sent but failed to record message'
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
