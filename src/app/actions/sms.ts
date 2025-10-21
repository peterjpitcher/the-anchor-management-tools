'use server'

import { createAdminClient } from '@/lib/supabase/server'
import twilio from 'twilio'
import { rateLimiters } from '@/lib/rate-limit'
import { headers } from 'next/headers'
import { sendSMS } from '@/lib/twilio'
import { logger } from '@/lib/logger'
import { formatPhoneForStorage, generatePhoneVariants } from '@/lib/utils'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { recordOutboundSmsMessage } from '@/lib/sms/logging'

interface TwilioMessageCreateParams {
  to: string
  body: string
  from?: string
  messagingServiceSid?: string
}

type CustomerFallback = {
  firstName?: string
  lastName?: string
  email?: string | null
}

type ResolvedCustomerResult = {
  customerId: string | null
  standardizedPhone?: string | null
}

function deriveNameParts(fullName?: string | null): CustomerFallback {
  if (!fullName) {
    return {}
  }

  const parts = fullName
    .split(' ')
    .map(part => part.trim())
    .filter(Boolean)

  if (parts.length === 0) {
    return {}
  }

  const [firstName, ...rest] = parts
  const lastName = rest.length > 0 ? rest.join(' ') : undefined

  return {
    firstName,
    lastName
  }
}

async function ensureCustomerForPhone(
  supabase: any,
  phone: string | null | undefined,
  fallback: CustomerFallback = {}
): Promise<ResolvedCustomerResult> {
  if (!phone) {
    return { customerId: null, standardizedPhone: null }
  }

  try {
    const standardizedPhone = formatPhoneForStorage(phone)
    const variants = generatePhoneVariants(standardizedPhone)
    const numbersToMatch = variants.length > 0 ? variants : [standardizedPhone]

    const { data: existingMatches, error: lookupError } = await supabase
      .from('customers')
      .select('id')
      .in('mobile_number', numbersToMatch)
      .order('created_at', { ascending: true })
      .limit(1)

    if (lookupError) {
      console.error('Failed to look up customer for SMS logging:', lookupError)
    }

    if (existingMatches && existingMatches.length > 0) {
      return { customerId: existingMatches[0].id, standardizedPhone }
    }

    const sanitizedFirstName = fallback.firstName?.trim()
    const sanitizedLastName = fallback.lastName?.trim()

    const fallbackFirstName = sanitizedFirstName && sanitizedFirstName.length > 0
      ? sanitizedFirstName
      : 'Unknown'

    let fallbackLastName = sanitizedLastName && sanitizedLastName.length > 0
      ? sanitizedLastName
      : null

    if (!fallbackLastName) {
      const digits = standardizedPhone.replace(/\D/g, '')
      fallbackLastName = digits.length >= 4 ? digits.slice(-4) : 'Contact'
    }

    const insertPayload = {
      first_name: fallbackFirstName,
      last_name: fallbackLastName,
      mobile_number: standardizedPhone,
      email: fallback.email ?? null,
      sms_opt_in: true
    }

    const { data: inserted, error: insertError } = await supabase
      .from('customers')
      .insert(insertPayload)
      .select('id')
      .single()

    if (insertError) {
      if ((insertError as any)?.code === '23505') {
        const { data: conflictMatches } = await supabase
          .from('customers')
          .select('id')
          .in('mobile_number', numbersToMatch)
          .order('created_at', { ascending: true })
          .limit(1)

        if (conflictMatches && conflictMatches.length > 0) {
          return { customerId: conflictMatches[0].id, standardizedPhone }
        }
      }

      console.error('Failed to create customer for SMS logging:', insertError)
      return { customerId: null, standardizedPhone }
    }

    return { customerId: inserted?.id ?? null, standardizedPhone }
  } catch (error) {
    console.error('Failed to resolve customer for phone:', error)
    return { customerId: null, standardizedPhone: null }
  }
}

async function resolveCustomerIdForSms(
  supabase: any,
  params: { bookingId?: string; customerId?: string; to: string }
): Promise<{ customerId: string | null }> {
  if (params.customerId) {
    return { customerId: params.customerId }
  }

  let bookingContext:
    | { type: 'private'; record: any }
    | { type: 'table'; record: any }
    | null = null

  if (params.bookingId) {
    const { data: privateBooking } = await supabase
      .from('private_bookings')
      .select(
        'id, customer_id, contact_phone, customer_first_name, customer_last_name, customer_name, contact_email'
      )
      .eq('id', params.bookingId)
      .maybeSingle()

    if (privateBooking) {
      if (privateBooking.customer_id) {
        return { customerId: privateBooking.customer_id }
      }

      bookingContext = { type: 'private', record: privateBooking }
    } else {
      const { data: tableBooking } = await supabase
        .from('table_bookings')
        .select(
          'id, customer_id, customer:customers(id, first_name, last_name, email, mobile_number)'
        )
        .eq('id', params.bookingId)
        .maybeSingle()

      if (tableBooking) {
        const linkedCustomerId = tableBooking.customer_id || tableBooking.customer?.id
        if (linkedCustomerId) {
          return { customerId: linkedCustomerId }
        }

        bookingContext = { type: 'table', record: tableBooking }
      }
    }
  }

  const bookingRecord = bookingContext?.record
  const nameFallback = bookingRecord?.customer_first_name || bookingRecord?.customer?.first_name
    ? {
        firstName: bookingRecord.customer_first_name || bookingRecord.customer?.first_name,
        lastName: bookingRecord.customer_last_name || bookingRecord.customer?.last_name || undefined
      }
    : deriveNameParts(bookingRecord?.customer_name)

  const fallbackInfo: CustomerFallback = {
    firstName: nameFallback?.firstName,
    lastName: nameFallback?.lastName,
    email: bookingRecord?.contact_email || bookingRecord?.customer?.email || null
  }

  const phoneToUse = bookingRecord?.contact_phone || bookingRecord?.customer?.mobile_number || params.to

  const { customerId } = await ensureCustomerForPhone(supabase, phoneToUse, fallbackInfo)

  if (customerId && bookingContext) {
    try {
      if (bookingContext.type === 'private') {
        const displayName = fallbackInfo.lastName
          ? `${fallbackInfo.firstName} ${fallbackInfo.lastName}`.trim()
          : fallbackInfo.firstName

        await supabase
          .from('private_bookings')
          .update({
            customer_id: customerId,
            customer_name: displayName || null
          })
          .eq('id', bookingContext.record.id)
      } else if (bookingContext.type === 'table') {
        await supabase
          .from('table_bookings')
          .update({ customer_id: customerId })
          .eq('id', bookingContext.record.id)
      }
    } catch (updateError) {
      console.error('Failed to link booking to customer:', updateError)
    }
  }

  return { customerId }
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
        await recordOutboundSmsMessage({
          supabase,
          customerId,
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

        await recordOutboundSmsMessage({
          supabase,
          customerId: customer.id,
          to: customer.mobile_number!,
          body: messageWithSupport,
          sid: sendResult.sid,
          metadata: { bulk_sms: true },
          status: 'sent',
          twilioStatus: 'queued'
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
