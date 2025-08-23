#!/usr/bin/env tsx

/**
 * Script to delete ALL queued/pending SMS messages for safety during testing
 * Run with: tsx scripts/delete-all-queued-messages.ts
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

async function deleteAllQueuedMessages() {
  console.log('🗑️  DELETING ALL QUEUED SMS MESSAGES\n')
  console.log('=' * 60)
  console.log('⚠️  This will delete ALL pending/queued messages to prevent accidental sends\n')

  try {
    // Get all messages that could potentially be sent
    const { data: queuedMessages, error: fetchError } = await supabase
      .from('messages')
      .select('id, body, status, created_at, direction, to_number')
      .in('status', ['queued', 'pending', 'sending', 'scheduled'])
      .eq('direction', 'outbound')

    if (fetchError) {
      console.error('❌ Error fetching queued messages:', fetchError)
      return
    }

    if (!queuedMessages || queuedMessages.length === 0) {
      console.log('✅ No queued messages found - queue is already clear!')
      
      // Still check for pending jobs
      await cleanupAllSmsJobs()
      return
    }

    console.log(`📊 Found ${queuedMessages.length} messages that could be sent:\n`)
    
    // Group by status
    const statusGroups = queuedMessages.reduce((acc, msg) => {
      acc[msg.status] = (acc[msg.status] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    console.log('STATUS BREAKDOWN:')
    Object.entries(statusGroups).forEach(([status, count]) => {
      console.log(`  ${status}: ${count} messages`)
    })

    // Show sample of messages
    console.log('\n📋 SAMPLE MESSAGES (first 5):')
    console.log('-' * 60)
    queuedMessages.slice(0, 5).forEach((msg, index) => {
      console.log(`${index + 1}. To: ${msg.to_number || 'Unknown'}`)
      console.log(`   Status: ${msg.status}`)
      console.log(`   Message: ${msg.body?.substring(0, 60)}...`)
      console.log(`   Created: ${new Date(msg.created_at).toLocaleDateString('en-GB')}`)
    })

    console.log(`\n⚠️  Will delete ALL ${queuedMessages.length} queued messages`)
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n')

    // Wait 5 seconds
    await new Promise(resolve => setTimeout(resolve, 5000))

    // Delete ALL queued messages
    const messageIds = queuedMessages.map(m => m.id)
    
    const { error: deleteError } = await supabase
      .from('messages')
      .delete()
      .in('id', messageIds)

    if (deleteError) {
      console.error('❌ Error deleting messages:', deleteError)
      return
    }

    console.log(`✅ Successfully deleted ${queuedMessages.length} queued messages`)

    // Clean up ALL SMS jobs
    await cleanupAllSmsJobs()

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
          reason: 'Clearing all queued messages for testing safety',
          script: 'delete-all-queued-messages.ts',
          messages_deleted: queuedMessages.length,
          status_breakdown: statusGroups
        }
      })

    // Final summary
    console.log('\n' + '=' * 60)
    console.log('📊 CLEANUP COMPLETE')
    console.log('=' * 60)
    console.log(`✅ Deleted ${queuedMessages.length} queued messages`)
    console.log('✅ Queue is now completely clear')
    console.log('✅ Safe to proceed with testing - no messages will be sent accidentally')

  } catch (error) {
    console.error('❌ Unexpected error:', error)
    process.exit(1)
  }
}

async function cleanupAllSmsJobs() {
  console.log('\n🧹 Cleaning up ALL pending SMS jobs...')
  
  // Delete ALL pending/failed/cancelled SMS jobs
  const { data: smsJobs, error: jobFetchError } = await supabase
    .from('jobs')
    .select('id, status, created_at')
    .eq('type', 'send_sms')
    .in('status', ['pending', 'failed', 'cancelled', 'processing'])

  if (!jobFetchError && smsJobs && smsJobs.length > 0) {
    const jobIds = smsJobs.map(j => j.id)
    
    console.log(`Found ${smsJobs.length} SMS jobs to delete`)
    
    const { error: jobDeleteError } = await supabase
      .from('jobs')
      .delete()
      .in('id', jobIds)

    if (jobDeleteError) {
      console.error('❌ Error deleting SMS jobs:', jobDeleteError)
    } else {
      console.log(`✅ Deleted ${smsJobs.length} SMS jobs`)
    }
  } else if (jobFetchError) {
    console.error('❌ Error fetching SMS jobs:', jobFetchError)
  } else {
    console.log('✅ No SMS jobs to clean up')
  }
}

// Run the script
deleteAllQueuedMessages().catch(console.error)