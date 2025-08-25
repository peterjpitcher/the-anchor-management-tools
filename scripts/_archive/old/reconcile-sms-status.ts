#!/usr/bin/env tsx

/**
 * SMS Status Reconciliation Script
 * Fetches actual status from Twilio API for messages stuck in queued/sent status
 * Run hourly via cron to ensure delivery status accuracy
 * 
 * Usage: tsx scripts/reconcile-sms-status.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'
import twilio from 'twilio'
import { mapTwilioStatus, isMessageStuck, formatErrorMessage } from '../src/lib/sms-status'

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL environment variable')
  process.exit(1)
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY environment variable')
  process.exit(1)
}

if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
  console.error('❌ Missing Twilio credentials')
  process.exit(1)
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
)

interface StuckMessage {
  id: string
  twilio_message_sid: string
  status: string
  twilio_status: string
  created_at: string
  direction: string
  to_number: string
}

async function reconcileSmsStatus() {
  console.log('🔄 SMS Status Reconciliation Starting')
  console.log('Time:', new Date().toISOString())
  console.log('=' .repeat(60))

  try {
    // Find messages that are stuck (outbound only)
    const { data: stuckMessages, error: fetchError } = await supabase
      .from('messages')
      .select('id, twilio_message_sid, status, twilio_status, created_at, direction, to_number')
      .in('status', ['queued', 'sent'])
      .in('direction', ['outbound', 'outbound-api'])
      .not('twilio_message_sid', 'is', null)
      .order('created_at', { ascending: true })
      .limit(100) as { data: StuckMessage[] | null, error: any }

    if (fetchError) {
      console.error('❌ Error fetching stuck messages:', fetchError)
      return
    }

    if (!stuckMessages || stuckMessages.length === 0) {
      console.log('✅ No stuck messages found')
      return
    }

    // Filter messages that are actually stuck based on time thresholds
    const messagesToReconcile = stuckMessages.filter(msg => 
      isMessageStuck(msg.status, msg.created_at, msg.direction)
    )

    console.log(`Found ${messagesToReconcile.length} messages needing reconciliation`)
    
    let updated = 0
    let failed = 0
    let unchanged = 0

    // Process each stuck message
    for (const message of messagesToReconcile) {
      try {
        console.log(`\nChecking message ${message.id} (SID: ${message.twilio_message_sid})`)
        console.log(`  Current status: ${message.status}, Age: ${getAgeInHours(message.created_at)} hours`)

        // Fetch current status from Twilio
        const twilioMessage = await twilioClient.messages(message.twilio_message_sid).fetch()
        
        const newStatus = twilioMessage.status.toLowerCase()
        const mappedStatus = mapTwilioStatus(newStatus)

        // Check if status has changed
        if (message.twilio_status === newStatus) {
          console.log(`  Status unchanged: ${newStatus}`)
          unchanged++
          
          // Check if it's been stuck in 'sent' for too long
          if (newStatus === 'sent' && getAgeInHours(message.created_at) > 6) {
            // Mark as delivery_unknown for UI clarity
            await supabase
              .from('messages')
              .update({
                status: 'delivery_unknown',
                updated_at: new Date().toISOString()
              })
              .eq('id', message.id)
            
            console.log(`  Marked as delivery_unknown (stuck in sent > 6 hours)`)
          }
          continue
        }

        console.log(`  Twilio status: ${newStatus} (mapped to: ${mappedStatus})`)

        // Update our database with the actual status
        const updateData: any = {
          status: mappedStatus,
          twilio_status: newStatus,
          updated_at: new Date().toISOString()
        }

        // Add timestamps based on status
        if (newStatus === 'delivered') {
          updateData.delivered_at = twilioMessage.dateUpdated || new Date().toISOString()
        } else if (newStatus === 'failed' || newStatus === 'undelivered') {
          updateData.failed_at = twilioMessage.dateUpdated || new Date().toISOString()
          updateData.error_code = twilioMessage.errorCode?.toString() || null
          updateData.error_message = twilioMessage.errorMessage || 
                                   (twilioMessage.errorCode ? formatErrorMessage(twilioMessage.errorCode) : null)
        } else if (newStatus === 'sent' && !message.sent_at) {
          updateData.sent_at = twilioMessage.dateSent || new Date().toISOString()
        }

        const { error: updateError } = await supabase
          .from('messages')
          .update(updateData)
          .eq('id', message.id)

        if (updateError) {
          console.error(`  ❌ Failed to update: ${updateError.message}`)
          failed++
        } else {
          console.log(`  ✅ Updated to: ${mappedStatus}`)
          updated++
          
          // Log to message_delivery_status for audit
          await supabase
            .from('message_delivery_status')
            .insert({
              message_id: message.id,
              status: newStatus,
              error_code: twilioMessage.errorCode?.toString() || null,
              error_message: twilioMessage.errorMessage || null,
              raw_webhook_data: { source: 'reconciliation', twilio_status: newStatus },
              note: 'Status updated via reconciliation',
              created_at: new Date().toISOString()
            })
        }

        // Add small delay to respect rate limits
        await sleep(100)

      } catch (error: any) {
        console.error(`  ❌ Error processing message ${message.id}:`, error.message)
        
        // Check for specific Twilio errors
        if (error.code === 20404) {
          console.log(`  Message not found in Twilio - marking as failed`)
          await supabase
            .from('messages')
            .update({
              status: 'failed',
              twilio_status: 'not_found',
              error_message: 'Message not found in Twilio',
              failed_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', message.id)
        }
        
        failed++
      }
    }

    // Summary
    console.log('\n' + '=' .repeat(60))
    console.log('📊 Reconciliation Summary:')
    console.log(`  Messages checked: ${messagesToReconcile.length}`)
    console.log(`  Updated: ${updated}`)
    console.log(`  Unchanged: ${unchanged}`)
    console.log(`  Failed: ${failed}`)

    // Check for messages stuck for a very long time (> 24 hours)
    const veryOldMessages = stuckMessages.filter(msg => 
      getAgeInHours(msg.created_at) > 24
    )

    if (veryOldMessages.length > 0) {
      console.log(`\n⚠️  WARNING: ${veryOldMessages.length} messages stuck for > 24 hours`)
      console.log('These may need manual investigation:')
      veryOldMessages.forEach(msg => {
        console.log(`  - ${msg.id}: ${msg.to_number} (${getAgeInHours(msg.created_at)} hours old)`)
      })
    }

    console.log('\n✅ Reconciliation complete')

  } catch (error) {
    console.error('❌ Unexpected error during reconciliation:', error)
    process.exit(1)
  }
}

function getAgeInHours(timestamp: string): number {
  const age = Date.now() - new Date(timestamp).getTime()
  return Math.round(age / (1000 * 60 * 60) * 10) / 10 // Round to 1 decimal
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Run the reconciliation
reconcileSmsStatus().catch(console.error)