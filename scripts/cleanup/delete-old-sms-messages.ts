#!/usr/bin/env tsx

/**
 * Script to delete old stuck SMS messages from the queue
 * Run with: tsx scripts/delete-old-sms-messages.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables')
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

async function deleteOldSmsMessages() {
  console.log('🗑️  Starting deletion of old stuck SMS messages...\n')
  console.log('=' * 60)

  try {
    // First, get all stuck messages to show what we're deleting
    const { data: stuckMessages, error: fetchError } = await supabase
      .from('messages')
      .select('id, body, status, created_at, customer_id, direction')
      .in('status', ['queued', 'pending', 'sending'])
      .eq('direction', 'outbound')
      .order('created_at', { ascending: true })

    if (fetchError) {
      console.error('❌ Error fetching stuck messages:', fetchError)
      return
    }

    if (!stuckMessages || stuckMessages.length === 0) {
      console.log('✅ No stuck messages found in the queue')
      return
    }

    console.log(`📊 Found ${stuckMessages.length} stuck messages\n`)

    // Group by age
    const now = Date.now()
    const oneDayAgo = now - (24 * 60 * 60 * 1000)
    const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000)
    const oneMonthAgo = now - (30 * 24 * 60 * 60 * 1000)

    const veryOld = stuckMessages.filter(m => new Date(m.created_at).getTime() < oneMonthAgo)
    const old = stuckMessages.filter(m => {
      const time = new Date(m.created_at).getTime()
      return time >= oneMonthAgo && time < oneWeekAgo
    })
    const recent = stuckMessages.filter(m => {
      const time = new Date(m.created_at).getTime()
      return time >= oneWeekAgo && time < oneDayAgo
    })
    const veryRecent = stuckMessages.filter(m => new Date(m.created_at).getTime() >= oneDayAgo)

    console.log('📅 MESSAGE AGE BREAKDOWN:')
    console.log('-' * 60)
    console.log(`  Over 30 days old: ${veryOld.length} messages`)
    console.log(`  7-30 days old: ${old.length} messages`)
    console.log(`  1-7 days old: ${recent.length} messages`)
    console.log(`  Less than 1 day old: ${veryRecent.length} messages`)

    // Show sample of oldest messages
    console.log('\n📋 OLDEST MESSAGES (first 5):')
    console.log('-' * 60)
    stuckMessages.slice(0, 5).forEach((msg, index) => {
      const age = Math.floor((now - new Date(msg.created_at).getTime()) / (1000 * 60 * 60 * 24))
      console.log(`${index + 1}. Created: ${new Date(msg.created_at).toLocaleDateString('en-GB')} (${age} days ago)`)
      console.log(`   Message: ${msg.body.substring(0, 80)}...`)
    })

    // We'll delete messages older than 7 days as they're definitely stale
    const messagesToDelete = stuckMessages.filter(m => 
      new Date(m.created_at).getTime() < oneWeekAgo
    )

    if (messagesToDelete.length === 0) {
      console.log('\n✅ No messages old enough to delete (all are less than 7 days old)')
      return
    }

    console.log(`\n⚠️  Will delete ${messagesToDelete.length} messages older than 7 days`)
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n')

    // Wait 5 seconds
    await new Promise(resolve => setTimeout(resolve, 5000))

    // Delete the old messages
    const messageIds = messagesToDelete.map(m => m.id)
    
    const { error: deleteError, count } = await supabase
      .from('messages')
      .delete()
      .in('id', messageIds)

    if (deleteError) {
      console.error('❌ Error deleting messages:', deleteError)
      return
    }

    console.log(`✅ Successfully deleted ${messagesToDelete.length} old messages`)

    // Also clean up related SMS jobs
    console.log('\n🧹 Cleaning up related SMS jobs...')
    
    // Delete old pending SMS jobs (older than 7 days)
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const { data: oldJobs, error: jobFetchError } = await supabase
      .from('jobs')
      .select('id, created_at, status')
      .eq('type', 'send_sms')
      .in('status', ['pending', 'failed', 'cancelled'])
      .lt('created_at', sevenDaysAgo.toISOString())

    if (!jobFetchError && oldJobs && oldJobs.length > 0) {
      const jobIds = oldJobs.map(j => j.id)
      const { error: jobDeleteError } = await supabase
        .from('jobs')
        .delete()
        .in('id', jobIds)

      if (jobDeleteError) {
        console.error('❌ Error deleting old jobs:', jobDeleteError)
      } else {
        console.log(`✅ Deleted ${oldJobs.length} old SMS jobs`)
      }
    } else {
      console.log('✅ No old SMS jobs to clean up')
    }

    // Log to audit trail
    await supabase
      .from('audit_logs')
      .insert({
        user_id: 'system-script',
        user_email: 'script@system',
        operation_type: 'delete',
        resource_type: 'messages',
        operation_status: 'success',
        details: {
          reason: 'Cleanup of old stuck SMS messages',
          script: 'delete-old-sms-messages.ts',
          messages_deleted: messagesToDelete.length,
          oldest_message_date: messagesToDelete[0]?.created_at,
          newest_message_date: messagesToDelete[messagesToDelete.length - 1]?.created_at
        }
      })

    // Final summary
    console.log('\n' + '=' * 60)
    console.log('📊 CLEANUP SUMMARY')
    console.log('=' * 60)
    console.log(`✅ Deleted ${messagesToDelete.length} stuck messages (older than 7 days)`)
    console.log(`ℹ️  Kept ${stuckMessages.length - messagesToDelete.length} recent messages (less than 7 days old)`)
    
    if (veryRecent.length > 0) {
      console.log(`\n⚠️  You still have ${veryRecent.length} messages from the last 24 hours that may need attention`)
      console.log('   These might be legitimate pending messages that could still be sent')
    }

    console.log('\n✨ Cleanup complete!')

  } catch (error) {
    console.error('❌ Unexpected error:', error)
    process.exit(1)
  }
}

// Run the script
deleteOldSmsMessages().catch(console.error)