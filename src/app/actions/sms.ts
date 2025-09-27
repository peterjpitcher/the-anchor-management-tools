'use server'

import { createAdminClient } from '@/lib/supabase/server'
import twilio from 'twilio'
import { rateLimiters } from '@/lib/rate-limit'
import { headers } from 'next/headers'
import { sendSMS } from '@/lib/twilio'
import { logger } from '@/lib/logger'

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

    if (customerId) {
      try {
        const supabase = createAdminClient()
        const messageLength = message.length
        const segments = messageLength <= 160 ? 1 : Math.ceil(messageLength / 153)
        const costUsd = segments * 0.04

        const { error: logError } = await supabase
          .from('messages')
          .insert({
            customer_id: customerId,
            direction: 'outbound',
            message_sid: twilioMessage.sid,
            twilio_message_sid: twilioMessage.sid,
            body: message,
            status: twilioMessage.status || 'queued',
            twilio_status: twilioMessage.status || 'queued',
            from_number: twilioMessage.from || process.env.TWILIO_PHONE_NUMBER || '',
            to_number: twilioMessage.to,
            message_type: 'sms',
            segments,
            cost_usd: costUsd,
            read_at: new Date().toISOString(),
            metadata: {
              context: 'otp'
            }
          })

        if (logError) {
          console.error('Failed to log OTP SMS message:', logError)
        }
      } catch (error) {
        console.error('Error recording OTP SMS message:', error)
      }
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

    const twilioClientInstance = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    )

    const messageParams: TwilioMessageCreateParams = {
      body: params.body,
      to: params.to
    }

    if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
      messageParams.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID
    } else if (process.env.TWILIO_PHONE_NUMBER) {
      messageParams.from = process.env.TWILIO_PHONE_NUMBER
    }

    const twilioMessage = await twilioClientInstance.messages.create(messageParams)

    const supabase = createAdminClient()
    const messageLength = params.body.length
    const segments = messageLength <= 160 ? 1 : Math.ceil(messageLength / 153)
    const costUsd = segments * 0.04

    await supabase.from('messages').insert({
      customer_id: params.customerId ?? null,
      direction: 'outbound',
      message_sid: twilioMessage.sid,
      twilio_message_sid: twilioMessage.sid,
      body: params.body,
      status: twilioMessage.status || 'queued',
      twilio_status: twilioMessage.status || 'queued',
      from_number: twilioMessage.from || process.env.TWILIO_PHONE_NUMBER || '',
      to_number: twilioMessage.to,
      message_type: 'sms',
      segments,
      cost_usd: costUsd,
      read_at: new Date().toISOString(),
      metadata: params.bookingId ? { booking_id: params.bookingId } : undefined
    })

    return { success: true, messageSid: twilioMessage.sid, sid: twilioMessage.sid }
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

    const messageLength = message.length
    const segments = messageLength <= 160 ? 1 : Math.ceil(messageLength / 153)
    const costUsd = segments * 0.04

    const results: Array<{ customerId: string; success: boolean; messageSid?: string; error?: string }> = []
    const errors: Array<{ customerId: string; error: string }> = []
    const messagesToInsert: Array<Record<string, unknown>> = []

    for (const customer of validCustomers) {
      try {
        const sendResult = await sendSMS(customer.mobile_number, message)

        if (!sendResult.success || !sendResult.sid) {
          errors.push({
            customerId: customer.id,
            error: sendResult.error || 'Failed to send message'
          })
          continue
        }

        messagesToInsert.push({
          customer_id: customer.id,
          direction: 'outbound' as const,
          message_sid: sendResult.sid,
          twilio_message_sid: sendResult.sid,
          body: message,
          status: 'sent' as const,
          twilio_status: 'queued' as const,
          from_number: process.env.TWILIO_PHONE_NUMBER || '',
          to_number: customer.mobile_number,
          message_type: 'sms' as const,
          segments,
          cost_usd: costUsd,
          read_at: new Date().toISOString(),
          metadata: { bulk_sms: true }
        })

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

    if (messagesToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('messages')
        .insert(messagesToInsert)

      if (insertError) {
        logger.error('Error recording bulk SMS messages', {
          error: insertError,
          metadata: { count: messagesToInsert.length }
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
