import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { mapTwilioStatus, isMessageStuck, formatErrorMessage, isStatusUpgrade } from '@/lib/sms-status'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

function resolveIsoTimestamp(value: Date | string | null | undefined): string {
  if (!value) {
    return new Date().toISOString()
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  const parsed = Date.parse(value)
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString()
  }

  return new Date().toISOString()
}

async function applySmsDeliveryOutcome(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    customerId?: string | null
    messageStatus?: string | null
    errorCode?: string | null
  }
) {
  const customerId = input.customerId
  if (!customerId || !input.messageStatus) {
    return
  }

  const normalizedStatus = input.messageStatus.toLowerCase()
  const nowIso = new Date().toISOString()

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id, sms_status, sms_opt_in, sms_delivery_failures')
    .eq('id', customerId)
    .maybeSingle()

  if (customerError || !customer) {
    if (customerError) {
      logger.warn('SMS reconciliation failed loading customer for delivery outcome update', {
        metadata: {
          customerId,
          error: customerError.message
        }
      })
    }
    return
  }

  if (normalizedStatus === 'delivered') {
    const { data: deliveredRow, error: deliveredUpdateError } = await supabase
      .from('customers')
      .update({
        sms_delivery_failures: 0,
        last_sms_failure_reason: null,
        last_successful_sms_at: nowIso
      })
      .eq('id', customerId)
      .select('id')
      .maybeSingle()

    if (deliveredUpdateError) {
      logger.warn('SMS reconciliation failed resetting customer SMS delivery counters', {
        metadata: {
          customerId,
          error: deliveredUpdateError.message
        }
      })
    } else if (!deliveredRow) {
      logger.warn('SMS reconciliation delivery-counter reset no-op due to missing customer row', {
        metadata: { customerId }
      })
    }
    return
  }

  const isFailureStatus = ['failed', 'undelivered', 'canceled'].includes(normalizedStatus)
  if (!isFailureStatus) {
    return
  }

  const nextFailures = Number(customer.sms_delivery_failures || 0) + 1
  const shouldDeactivate = nextFailures > 3 && customer.sms_status !== 'opted_out'
  const updatePayload: Record<string, unknown> = {
    sms_delivery_failures: nextFailures,
    last_sms_failure_reason: input.errorCode ? formatErrorMessage(input.errorCode) : 'Message delivery failed'
  }

  if (shouldDeactivate && customer.sms_status !== 'sms_deactivated') {
    updatePayload.sms_status = 'sms_deactivated'
    updatePayload.sms_opt_in = false
    updatePayload.sms_deactivated_at = nowIso
    updatePayload.sms_deactivation_reason = 'delivery_failures'
  }

  const { data: failureRow, error: failureUpdateError } = await supabase
    .from('customers')
    .update(updatePayload)
    .eq('id', customerId)
    .select('id')
    .maybeSingle()

  if (failureUpdateError) {
    logger.warn('SMS reconciliation failed updating customer SMS failure counters', {
      metadata: {
        customerId,
        error: failureUpdateError.message
      }
    })
  } else if (!failureRow) {
    logger.warn('SMS reconciliation failure-counter update no-op due to missing customer row', {
      metadata: { customerId }
    })
  }
}

export async function GET(request: NextRequest) {
  logger.info('SMS reconciliation cron starting', {
    metadata: { startedAt: new Date().toISOString() }
  })
  
  const authResult = authorizeCronRequest(request)

  if (!authResult.authorized) {
    logger.warn('Unauthorized SMS reconciliation attempt', {
      metadata: { reason: authResult.reason || null }
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN
  if (!twilioAccountSid || !twilioAuthToken) {
    logger.error('SMS reconciliation skipped: Twilio configuration missing')
    return NextResponse.json({ error: 'Twilio configuration missing' }, { status: 503 })
  }

  const twilioClient = twilio(
    twilioAccountSid,
    twilioAuthToken
  )

  try {
    const supabase = createAdminClient()
    // Find stuck messages
    const { data: stuckMessages, error: fetchError } = await supabase
      .from('messages')
      .select('id, twilio_message_sid, status, twilio_status, created_at, direction, customer_id')
      .in('status', ['queued', 'sent'])
      .in('direction', ['outbound', 'outbound-api'])
      .not('twilio_message_sid', 'is', null)
      .order('created_at', { ascending: true })
      .limit(50) // Limit per run to avoid timeout

    if (fetchError) {
      logger.error('SMS reconciliation failed fetching stuck messages', {
        metadata: { error: fetchError.message }
      })
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    if (!stuckMessages || stuckMessages.length === 0) {
      logger.info('SMS reconciliation found no stuck messages')
      return NextResponse.json({ 
        success: true, 
        message: 'No messages to reconcile',
        timestamp: new Date().toISOString()
      })
    }

    // Filter actually stuck messages
    const messagesToReconcile = stuckMessages.filter(msg => 
      isMessageStuck(msg.status, msg.created_at, msg.direction)
    )

    logger.info('SMS reconciliation identified stuck messages', {
      metadata: { count: messagesToReconcile.length }
    })

    let updated = 0
    let errors = 0

    // Process each message
    for (const message of messagesToReconcile) {
      try {
        // Fetch from Twilio
        const twilioMessage = await twilioClient.messages(message.twilio_message_sid).fetch()
        const newStatus = twilioMessage.status.toLowerCase()

        // Skip if unchanged
        if (message.twilio_status === newStatus) {
          continue
        }

        if (!isStatusUpgrade(message.twilio_status, newStatus)) {
          const { error: regressionHistoryError } = await supabase
            .from('message_delivery_status')
            .insert({
              message_id: message.id,
              status: newStatus,
              note: 'Status regression prevented by cron reconciliation',
              created_at: new Date().toISOString()
            })

          if (regressionHistoryError) {
            logger.warn('Failed to insert status regression audit entry during reconciliation', {
              metadata: {
                messageId: message.id,
                twilioSid: message.twilio_message_sid,
                status: newStatus,
                error: regressionHistoryError.message
              }
            })
          }
          continue
        }

        // Update database
        const updateData: any = {
          status: mapTwilioStatus(newStatus),
          twilio_status: newStatus,
          updated_at: new Date().toISOString()
        }

        // Add status-specific fields
        if (newStatus === 'delivered') {
          updateData.delivered_at = resolveIsoTimestamp(twilioMessage.dateUpdated || null)
        } else if (newStatus === 'failed' || newStatus === 'undelivered') {
          updateData.failed_at = resolveIsoTimestamp(twilioMessage.dateUpdated || null)
          updateData.error_code = twilioMessage.errorCode?.toString() || null
          updateData.error_message = twilioMessage.errorMessage || 
                                   (twilioMessage.errorCode ? formatErrorMessage(twilioMessage.errorCode) : null)
        }

        const { data: updatedMessageRow, error: updateError } = await supabase
          .from('messages')
          .update(updateData)
          .eq('id', message.id)
          .select('id')
          .maybeSingle()

        if (!updateError && updatedMessageRow) {
          updated++
          
          // Log for audit
          const { error: deliveryStatusError } = await supabase
            .from('message_delivery_status')
            .insert({
              message_id: message.id,
              status: newStatus,
              note: 'Updated via cron reconciliation',
              created_at: new Date().toISOString()
            })

          if (deliveryStatusError) {
            logger.warn('Failed to insert message delivery status during reconciliation', {
              metadata: {
                messageId: message.id,
                twilioSid: message.twilio_message_sid,
                error: deliveryStatusError.message
              }
            })
          }

          await applySmsDeliveryOutcome(supabase, {
            customerId: message.customer_id,
            messageStatus: newStatus,
            errorCode: twilioMessage.errorCode?.toString() || null
          })
        } else if (updateError) {
          logger.error('Failed to update message status during reconciliation', {
            metadata: {
              messageId: message.id,
              twilioSid: message.twilio_message_sid,
              error: updateError.message
            }
          })
          errors++
        } else {
          logger.warn('Message reconciliation update no-op due to missing row', {
            metadata: {
              messageId: message.id,
              twilioSid: message.twilio_message_sid
            }
          })
          errors++
        }

        // Small delay for rate limiting
        await new Promise(resolve => setTimeout(resolve, 100))

      } catch (error: any) {
        logger.error('Error reconciling SMS delivery state', {
          error: error instanceof Error ? error : new Error(String(error)),
          metadata: {
            messageId: message.id,
            twilioSid: message.twilio_message_sid
          }
        })
        
        // Handle message not found
        const twilioErrorCode =
          typeof error?.code === 'number'
            ? error.code
            : typeof error?.code === 'string'
              ? Number.parseInt(error.code, 10)
              : Number.NaN
        if (twilioErrorCode === 20404) {
          const { data: notFoundRow, error: notFoundUpdateError } = await supabase
            .from('messages')
            .update({
              status: 'failed',
              twilio_status: 'not_found',
              error_message: 'Message not found in Twilio',
              failed_at: new Date().toISOString()
            })
            .eq('id', message.id)
            .select('id')
            .maybeSingle()

          if (notFoundUpdateError) {
            logger.error('Failed to mark missing Twilio message as failed', {
              metadata: {
                messageId: message.id,
                twilioSid: message.twilio_message_sid,
                error: notFoundUpdateError.message
              }
            })
          } else if (!notFoundRow) {
            logger.warn('Twilio missing-message reconciliation no-op due to missing row', {
              metadata: {
                messageId: message.id,
                twilioSid: message.twilio_message_sid
              }
            })
            errors++
          } else {
            const { error: notFoundHistoryError } = await supabase
              .from('message_delivery_status')
              .insert({
                message_id: message.id,
                status: 'not_found',
                note: 'Twilio message SID not found during reconciliation',
                created_at: new Date().toISOString()
              })

            if (notFoundHistoryError) {
              logger.warn('Failed to insert Twilio not-found audit entry during reconciliation', {
                metadata: {
                  messageId: message.id,
                  twilioSid: message.twilio_message_sid,
                  error: notFoundHistoryError.message
                }
              })
            }

            await applySmsDeliveryOutcome(supabase, {
              customerId: message.customer_id,
              messageStatus: 'failed',
              errorCode: '20404'
            })
          }
        }
        
        errors++
      }
    }

    const result = {
      success: true,
      checked: messagesToReconcile.length,
      updated,
      errors,
      timestamp: new Date().toISOString()
    }

    logger.info('SMS reconciliation complete', { metadata: result })
    return NextResponse.json(result)

  } catch (error: any) {
    logger.error('SMS reconciliation unexpected error', {
      error: error instanceof Error ? error : new Error(String(error))
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
