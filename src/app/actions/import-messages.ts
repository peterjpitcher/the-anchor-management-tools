'use server'

import twilio from 'twilio'
import { createClient, createAdminClient } from '@/lib/supabase/server'
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
    console.error('Error verifying messages permissions:', error)
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
    let allMessages: any[] = []

    try {
      await twilioClient.messages.each(
        {
          dateSentAfter: new Date(startDate),
          dateSentBefore: new Date(endDate),
          pageSize: 100,
        },
        (message) => {
          allMessages.push(message)
        },
      )
    } catch (error) {
      console.error('Error fetching messages with pagination:', error)
      allMessages = await twilioClient.messages.list({
        dateSentAfter: new Date(startDate),
        dateSentBefore: new Date(endDate),
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
    const { data: existingMessages } = await admin
      .from('messages')
      .select('twilio_message_sid')
      .in('twilio_message_sid', messageSids)

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

    const { data: existingCustomers } = await admin
      .from('customers')
      .select('*')
      .in('mobile_number', Array.from(phoneNumbers))

    const customerMap = new Map(
      existingCustomers?.map((c) => [c.mobile_number, c]) || [],
    )

    const customersToCreate: Record<string, any>[] = []
    for (const phone of phoneNumbers) {
      if (!customerMap.has(phone)) {
        customersToCreate.push({
          first_name: 'Unknown',
          last_name: phone.replace(/\D/g, '').slice(-4),
          mobile_number: phone,
          sms_opt_in: true,
        })
      }
    }

    if (customersToCreate.length > 0) {
      const { data: newCustomers, error: createError } = await admin
        .from('customers')
        .insert(customersToCreate)
        .select()

      if (createError) {
        console.error('Failed to create customers:', createError)
      } else if (newCustomers) {
        newCustomers.forEach((customer) => {
          customerMap.set(customer.mobile_number, customer)
        })
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
        .insert(messagesToInsert)
        .select()

      if (batchError) {
        console.error('Failed to batch insert messages:', batchError)
        failed += messagesToInsert.length
        errors.push(
          `Failed to batch insert ${messagesToInsert.length} messages: ${batchError.message}`,
        )
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
    console.error('Import failed:', error)
    const message = `Import failed: ${
      error instanceof Error ? error.message : 'Unknown error'
    }`
    await logFailure(message)
    return { error: message }
  }
}
