import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'
import { mapTwilioStatus, isMessageStuck, formatErrorMessage } from '@/lib/sms-status'
import { authorizeCronRequest } from '@/lib/cron-auth'

export async function GET(request: NextRequest) {
  console.log('[CRON] SMS Reconciliation starting at', new Date().toISOString())
  
  const authResult = authorizeCronRequest(request)

  if (!authResult.authorized) {
    console.error('[CRON] Unauthorized reconciliation attempt')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Initialize clients
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )

  const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID!,
    process.env.TWILIO_AUTH_TOKEN!
  )

  try {
    // Find stuck messages
    const { data: stuckMessages, error: fetchError } = await supabase
      .from('messages')
      .select('id, twilio_message_sid, status, twilio_status, created_at, direction')
      .in('status', ['queued', 'sent'])
      .in('direction', ['outbound', 'outbound-api'])
      .not('twilio_message_sid', 'is', null)
      .order('created_at', { ascending: true })
      .limit(50) // Limit per run to avoid timeout

    if (fetchError) {
      console.error('[CRON] Error fetching messages:', fetchError)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    if (!stuckMessages || stuckMessages.length === 0) {
      console.log('[CRON] No stuck messages found')
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

    console.log(`[CRON] Found ${messagesToReconcile.length} messages to reconcile`)

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

        // Update database
        const updateData: any = {
          status: mapTwilioStatus(newStatus),
          twilio_status: newStatus,
          updated_at: new Date().toISOString()
        }

        // Add status-specific fields
        if (newStatus === 'delivered') {
          updateData.delivered_at = twilioMessage.dateUpdated || new Date().toISOString()
        } else if (newStatus === 'failed' || newStatus === 'undelivered') {
          updateData.failed_at = twilioMessage.dateUpdated || new Date().toISOString()
          updateData.error_code = twilioMessage.errorCode?.toString() || null
          updateData.error_message = twilioMessage.errorMessage || 
                                   (twilioMessage.errorCode ? formatErrorMessage(twilioMessage.errorCode) : null)
        }

        const { error: updateError } = await supabase
          .from('messages')
          .update(updateData)
          .eq('id', message.id)

        if (!updateError) {
          updated++
          
          // Log for audit
          await supabase
            .from('message_delivery_status')
            .insert({
              message_id: message.id,
              status: newStatus,
              note: 'Updated via cron reconciliation',
              created_at: new Date().toISOString()
            })
        } else {
          errors++
        }

        // Small delay for rate limiting
        await new Promise(resolve => setTimeout(resolve, 100))

      } catch (error: any) {
        console.error(`[CRON] Error reconciling message ${message.id}:`, error.message)
        
        // Handle message not found
        if (error.code === 20404) {
          await supabase
            .from('messages')
            .update({
              status: 'failed',
              twilio_status: 'not_found',
              error_message: 'Message not found in Twilio',
              failed_at: new Date().toISOString()
            })
            .eq('id', message.id)
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

    console.log('[CRON] Reconciliation complete:', result)
    return NextResponse.json(result)

  } catch (error: any) {
    console.error('[CRON] Unexpected error:', error)
    return NextResponse.json({ 
      error: 'Internal server error',
      message: error.message 
    }, { status: 500 })
  }
}
