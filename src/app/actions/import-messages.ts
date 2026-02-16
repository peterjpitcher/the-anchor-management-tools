'use server'

import twilio from 'twilio'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { logAuditEvent } from '@/app/actions/audit'
import type { ActionType } from '@/types/rbac'
import type { User as SupabaseUser } from '@supabase/supabase-js'

type MessagesPermission = Extract<ActionType, 'view' | 'manage'>

type PermissionResult =
  | { error: string }
  | { user: SupabaseUser; admin: ReturnType<typeof createAdminClient> }

async function requireMessagesPermission(
  action: MessagesPermission,
): Promise<PermissionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: 'messages',
    p_action: action,
  })

  if (error) {
    logger.error('Error verifying messages permissions', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { action },
    })
    return { error: 'Failed to verify permissions' }
  }

  if (data !== true) {
    return { error: 'Insufficient permissions' }
  }

  return { user, admin }
}

interface ImportSummary {
  totalFound: number;
  inboundMessages: number;
  outboundMessages: number;
  alreadyInDatabase: number;
  imported: number;
  failed: number;
}

type ImportResult =
  | {
      success: true;
      summary: ImportSummary;
      errors?: string[];
    }
  | { error: string }

export async function importMissedMessages(
  startDate: string,
  endDate: string,
): Promise<ImportResult> {
  const permission = await requireMessagesPermission('manage')
  if ('error' in permission) {
    return { error: permission.error }
  }

  const { user, admin } = permission
  const baseAdditionalInfo = { startDate, endDate }

  const logFailure = async (errorMessage: string, extra?: Record<string, any>) => {
    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'import',
      resource_type: 'messages',
      operation_status: 'failure',
      error_message: errorMessage,
      additional_info: { ...baseAdditionalInfo, ...(extra ?? {}) },
    })
  }

  const logSuccess = async (summary: ImportSummary, extra?: Record<string, any>) => {
    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'import',
      resource_type: 'messages',
      operation_status: 'success',
      new_values: summary,
      additional_info: { ...baseAdditionalInfo, ...(extra ?? {}) },
    })
  }

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    const message = 'Twilio credentials not configured'
    await logFailure(message)
    return { error: message }
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const message = 'Supabase credentials not configured'
    await logFailure(message)
    return { error: message }
  }

  const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER || '+447700106752'
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID

  const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN,
  )

  try {
    const parsedStart = new Date(startDate)
    const parsedEnd = new Date(endDate)

    if (Number.isNaN(parsedStart.getTime()) || Number.isNaN(parsedEnd.getTime())) {
      const message = 'Invalid start or end date'
      await logFailure(message)
      return { error: message }
    }

    if (parsedEnd.getTime() < parsedStart.getTime()) {
      const message = 'End date must be on or after start date'
      await logFailure(message)
      return { error: message }
    }

    let allMessages: any[] = []

    try {
      await twilioClient.messages.each(
        {
          dateSentAfter: parsedStart,
          dateSentBefore: parsedEnd,
          pageSize: 100,
        },
        (message) => {
          allMessages.push(message)
        },
      )
    } catch (error) {
      logger.warn('Error fetching Twilio messages with pagination; falling back to list()', {
        metadata: {
          startDate,
          endDate,
          error: error instanceof Error ? error.message : String(error),
        },
      })
      allMessages = await twilioClient.messages.list({
        dateSentAfter: parsedStart,
        dateSentBefore: parsedEnd,
        limit: 1000,
      })
    }

    const messages = allMessages
    const inboundMessages = messages.filter((msg) => msg.direction === 'inbound')
    const outboundMessages = messages.filter((msg) =>
      ['outbound-api', 'outbound-call', 'outbound-reply', 'outbound'].includes(
        msg.direction,
      ),
    )

    const combinedMessages = [...inboundMessages, ...outboundMessages]
    const messageSids = combinedMessages.map((m) => m.sid)
    if (messageSids.length === 0) {
      const summary = {
        totalFound: messages.length,
        inboundMessages: inboundMessages.length,
        outboundMessages: outboundMessages.length,
        alreadyInDatabase: 0,
        imported: 0,
        failed: 0,
      }

      await logSuccess(summary, {
        messagingServiceSid,
        twilioPhoneNumber,
        errorCount: 0,
      })

      return {
        success: true,
        summary,
      }
    }

    const { data: existingMessages, error: existingMessagesError } = await admin
      .from('messages')
      .select('twilio_message_sid')
      .in('twilio_message_sid', messageSids)

    if (existingMessagesError) {
      logger.error('Failed checking existing message SIDs during import', {
        error: new Error(existingMessagesError.message),
        metadata: { messageSidCount: messageSids.length },
      })
      const message = 'Failed to verify existing messages'
      await logFailure(message, { detail: existingMessagesError.message })
      return { error: message }
    }

    const existingSids = new Set(
      existingMessages?.map((m) => m.twilio_message_sid) || [],
    )
    const newMessages = combinedMessages.filter((m) => !existingSids.has(m.sid))

    const phoneNumbers = new Set<string>()
    newMessages.forEach((msg) => {
      const phone = msg.direction === 'inbound' ? msg.from : msg.to
      if (phone) {
        phoneNumbers.add(phone)
      }
    })

    const phoneNumbersList = Array.from(phoneNumbers)
    const customerMap = new Map<string, any>()

    if (phoneNumbersList.length > 0) {
      const selectCustomerFields =
        'id, first_name, last_name, mobile_number, mobile_e164, mobile_number_raw'

      const {
        data: existingCustomersByE164,
        error: existingCustomersByE164Error,
      } = await admin
        .from('customers')
        .select(selectCustomerFields)
        .in('mobile_e164', phoneNumbersList)

      if (existingCustomersByE164Error) {
        logger.error('Failed loading existing customers by mobile_e164 during import', {
          error: new Error(existingCustomersByE164Error.message),
        })
        const message = 'Failed to verify existing customers'
        await logFailure(message, { detail: existingCustomersByE164Error.message })
        return { error: message }
      }

      const {
        data: existingCustomersByMobile,
        error: existingCustomersByMobileError,
      } = await admin
        .from('customers')
        .select(selectCustomerFields)
        .in('mobile_number', phoneNumbersList)

      if (existingCustomersByMobileError) {
        logger.error('Failed loading existing customers by mobile_number during import', {
          error: new Error(existingCustomersByMobileError.message),
        })
        const message = 'Failed to verify existing customers'
        await logFailure(message, { detail: existingCustomersByMobileError.message })
        return { error: message }
      }

      const {
        data: existingCustomersByRaw,
        error: existingCustomersByRawError,
      } = await admin
        .from('customers')
        .select(selectCustomerFields)
        .in('mobile_number_raw', phoneNumbersList)

      if (existingCustomersByRawError) {
        logger.error('Failed loading existing customers by mobile_number_raw during import', {
          error: new Error(existingCustomersByRawError.message),
        })
        const message = 'Failed to verify existing customers'
        await logFailure(message, { detail: existingCustomersByRawError.message })
        return { error: message }
      }

      const allCustomers = [
        ...(existingCustomersByE164 ?? []),
        ...(existingCustomersByMobile ?? []),
        ...(existingCustomersByRaw ?? []),
      ]

      for (const customer of allCustomers) {
        const keys = [
          customer.mobile_e164,
          customer.mobile_number,
          customer.mobile_number_raw,
        ].filter((value): value is string => typeof value === 'string' && value.length > 0)

        for (const key of keys) {
          if (phoneNumbers.has(key) && !customerMap.has(key)) {
            customerMap.set(key, customer)
          }
        }
      }
    }

    const customersToCreate: Record<string, any>[] = []
    for (const phone of phoneNumbers) {
      if (!customerMap.has(phone)) {
        const digits = phone.replace(/\D/g, '')
        const lastName = digits.length >= 4 ? digits.slice(-4) : 'Contact'
        const nowIso = new Date().toISOString()
        customersToCreate.push({
          first_name: 'Unknown',
          last_name: lastName,
          mobile_number: phone,
          mobile_e164: phone,
          mobile_number_raw: phone,
          sms_opt_in: false,
          marketing_sms_opt_in: false,
          sms_status: 'sms_deactivated',
          sms_deactivated_at: nowIso,
          sms_deactivation_reason: 'import_missed_messages_placeholder',
        })
      }
    }

    if (customersToCreate.length > 0) {
      const { error: createError } = await admin
        .from('customers')
        .upsert(customersToCreate, {
          onConflict: 'mobile_e164',
          ignoreDuplicates: true,
        })

      if (createError) {
        logger.error('Failed to create placeholder customers during import', {
          error: new Error(createError.message),
          metadata: { customerCount: customersToCreate.length },
        })
        const message = 'Failed to create placeholder customers'
        await logFailure(message, { detail: createError.message })
        return { error: message }
      }

      const selectCustomerFields =
        'id, first_name, last_name, mobile_number, mobile_e164, mobile_number_raw'
      const { data: refreshedCustomers, error: refreshedCustomersError } = await admin
        .from('customers')
        .select(selectCustomerFields)
        .in(
          'mobile_e164',
          customersToCreate
            .map((customer) => customer.mobile_e164)
            .filter((value): value is string => typeof value === 'string' && value.length > 0),
        )

      if (refreshedCustomersError) {
        logger.error('Failed to reload placeholder customers during import', {
          error: new Error(refreshedCustomersError.message),
          metadata: { customerCount: customersToCreate.length },
        })
        const message = 'Failed to verify placeholder customers'
        await logFailure(message, { detail: refreshedCustomersError.message })
        return { error: message }
      }

      for (const customer of refreshedCustomers ?? []) {
        const keys = [
          customer.mobile_e164,
          customer.mobile_number,
          customer.mobile_number_raw,
        ].filter((value): value is string => typeof value === 'string' && value.length > 0)

        for (const key of keys) {
          if (phoneNumbers.has(key) && !customerMap.has(key)) {
            customerMap.set(key, customer)
          }
        }
      }

      const unresolvedPhones = Array.from(phoneNumbers).filter((phone) => !customerMap.has(phone))
      if (unresolvedPhones.length > 0) {
        const message = `Failed to resolve ${unresolvedPhones.length} customer(s) needed for import`
        await logFailure(message, { unresolvedPhones })
        return { error: message }
      }
    }

    let imported = 0
    let failed = 0
    const errors: string[] = []
    const messagesToInsert: Record<string, any>[] = []

    for (const twilioMessage of newMessages) {
      try {
        const isInbound = twilioMessage.direction === 'inbound'
        const customerPhone = isInbound ? twilioMessage.from : twilioMessage.to

        if (!customerPhone) {
          errors.push(`No phone number found for message ${twilioMessage.sid}`)
          failed++
          continue
        }

        const customer = customerMap.get(customerPhone)
        if (!customer) {
          errors.push(`Customer not found for ${customerPhone}`)
          failed++
          continue
        }

        let segments = 1
        let costUsd = 0
        if (!isInbound && twilioMessage.body) {
          segments =
            twilioMessage.numSegments ||
            (twilioMessage.body.length <= 160
              ? 1
              : Math.ceil(twilioMessage.body.length / 153))
          costUsd = segments * 0.04
        }

        messagesToInsert.push({
          customer_id: customer.id,
          direction: isInbound ? 'inbound' : 'outbound',
          message_sid: twilioMessage.sid,
          twilio_message_sid: twilioMessage.sid,
          body: twilioMessage.body || '',
          status: twilioMessage.status,
          twilio_status: twilioMessage.status,
          from_number: twilioMessage.from || '',
          to_number: twilioMessage.to || '',
          message_type: 'sms',
          created_at: twilioMessage.dateCreated || twilioMessage.dateSent,
          sent_at: twilioMessage.dateSent,
          segments,
          cost_usd: costUsd,
          read_at: !isInbound ? new Date().toISOString() : null,
        })
      } catch (error) {
        errors.push(`Error processing message ${twilioMessage.sid}: ${error}`)
        failed++
      }
    }

    if (messagesToInsert.length > 0) {
      const { data: insertedMessages, error: batchError } = await admin
        .from('messages')
        .upsert(messagesToInsert, {
          onConflict: 'twilio_message_sid',
          ignoreDuplicates: true,
        })
        .select('twilio_message_sid')

      if (batchError) {
        logger.error('Failed to batch insert messages during import', {
          error: new Error(batchError.message),
          metadata: { messageCount: messagesToInsert.length },
        })
        const message = `Failed to import messages: ${batchError.message}`
        await logFailure(message, { detail: batchError.message })
        return { error: message }
      } else {
        imported = insertedMessages?.length || 0
      }
    }

    const summary = {
      totalFound: messages.length,
      inboundMessages: inboundMessages.length,
      outboundMessages: outboundMessages.length,
      alreadyInDatabase: existingSids.size,
      imported,
      failed,
    }

    await logSuccess(summary, {
      messagingServiceSid,
      twilioPhoneNumber,
      errorCount: errors.length,
    })

    return {
      success: true,
      summary,
      errors: errors.length > 0 ? errors : undefined,
    }
  } catch (error) {
    logger.error('Import missed messages failed', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    const message = `Import failed: ${
      error instanceof Error ? error.message : 'Unknown error'
    }`
    await logFailure(message)
    return { error: message }
  }
}
