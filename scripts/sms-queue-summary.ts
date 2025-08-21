#!/usr/bin/env tsx

/**
 * Script to get a summary of SMS queue status
 * Run with: tsx scripts/sms-queue-summary.ts
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

async function getSmsQueueSummary() {
  console.log('📱 SMS Queue Summary\n')
  console.log('=' * 60)

  try {
    // Get status counts
    const { data: messages } = await supabase
      .from('messages')
      .select('status, created_at, direction')

    if (!messages) {
      console.log('No messages found')
      return
    }

    // Group by status
    const statusCounts = messages.reduce((acc, msg) => {
      const key = `${msg.direction}_${msg.status}`
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    // Get date range of queued messages
    const queuedMessages = messages.filter(m => m.status === 'queued' || m.status === 'pending')
    const oldestQueued = queuedMessages.length > 0 
      ? new Date(Math.min(...queuedMessages.map(m => new Date(m.created_at).getTime())))
      : null
    const newestQueued = queuedMessages.length > 0
      ? new Date(Math.max(...queuedMessages.map(m => new Date(m.created_at).getTime())))
      : null

    console.log('\n📊 MESSAGE STATUS BREAKDOWN:')
    console.log('-' * 60)
    
    // Outbound messages
    console.log('\nOutbound Messages:')
    console.log(`  Queued: ${statusCounts['outbound_queued'] || 0}`)
    console.log(`  Pending: ${statusCounts['outbound_pending'] || 0}`)
    console.log(`  Sent: ${statusCounts['outbound_sent'] || 0}`)
    console.log(`  Delivered: ${statusCounts['outbound_delivered'] || 0}`)
    console.log(`  Failed: ${statusCounts['outbound_failed'] || 0}`)
    
    // Inbound messages
    console.log('\nInbound Messages:')
    console.log(`  Received: ${statusCounts['inbound_received'] || 0}`)
    
    if (queuedMessages.length > 0) {
      console.log('\n⚠️  STUCK MESSAGES IN QUEUE:')
      console.log('-' * 60)
      console.log(`Total stuck: ${queuedMessages.length}`)
      console.log(`Oldest: ${oldestQueued?.toLocaleDateString('en-GB')} ${oldestQueued?.toLocaleTimeString('en-GB')}`)
      console.log(`Newest: ${newestQueued?.toLocaleDateString('en-GB')} ${newestQueued?.toLocaleTimeString('en-GB')}`)
      
      const ageInDays = oldestQueued ? Math.floor((Date.now() - oldestQueued.getTime()) / (1000 * 60 * 60 * 24)) : 0
      console.log(`\n🚨 Messages have been stuck for ${ageInDays} days!`)
    }

    // Check jobs queue
    const { data: jobs } = await supabase
      .from('jobs')
      .select('status, type')
      .eq('type', 'send_sms')

    const jobCounts = jobs?.reduce((acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1
      return acc
    }, {} as Record<string, number>) || {}

    console.log('\n⚙️  SMS JOBS STATUS:')
    console.log('-' * 60)
    Object.entries(jobCounts).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`)
    })

    // Recommendations
    console.log('\n💡 RECOMMENDATIONS:')
    console.log('-' * 60)
    
    if (queuedMessages.length > 0) {
      console.log('1. ❌ CRITICAL: You have ' + queuedMessages.length + ' messages stuck in queue')
      console.log('   These messages were never sent through Twilio')
      console.log('   Options:')
      console.log('   - Process the queue manually')
      console.log('   - Clear old messages and notify customers')
      console.log('   - Fix the SMS sending integration')
      console.log('\n2. Check Twilio configuration:')
      console.log('   - Verify TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN')
      console.log('   - Check Twilio account balance')
      console.log('   - Verify phone number is active')
    } else {
      console.log('✅ No stuck messages - queue is clear!')
    }

    console.log('\n' + '=' * 60)

  } catch (error) {
    console.error('❌ Error:', error)
  }
}

// Run the script
getSmsQueueSummary().catch(console.error)