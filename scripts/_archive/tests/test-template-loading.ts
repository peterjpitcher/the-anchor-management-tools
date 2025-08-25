#!/usr/bin/env tsx

/**
 * Test script to verify that message templates are being loaded correctly
 */

import { getMessageTemplate, getMessageTemplatesBatch } from '../src/lib/smsTemplates'
import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables
config({ path: resolve(__dirname, '../.env.local') })

async function testTemplateLoading() {
  console.log('🧪 Testing template loading...\n')

  // Test single template loading
  console.log('1️⃣ Testing single template loading with getMessageTemplate()...')
  
  // Use a dummy event ID for testing
  const testEventId = '00000000-0000-0000-0000-000000000000'
  const testVariables = {
    customer_name: 'John Smith',
    first_name: 'John',
    event_name: 'Quiz Night',
    event_date: '25th December',
    event_time: '7:00 PM',
    seats: '4',
    venue_name: 'The Anchor',
    contact_phone: '+44 7700 900123',
    booking_reference: 'BK-12345'
  }

  const templateTypes = [
    'bookingConfirmation',
    'reminderOnly', 
    'dayBeforeReminder',
    'weekBeforeReminder'
  ]

  for (const templateType of templateTypes) {
    console.log(`\n  Testing ${templateType}:`)
    const template = await getMessageTemplate(testEventId, templateType, testVariables)
    
    if (template) {
      console.log(`  ✅ Template loaded successfully`)
      console.log(`  📝 Content: ${template.substring(0, 80)}...`)
    } else {
      console.log(`  ❌ Failed to load template`)
    }
  }

  // Test batch loading
  console.log('\n\n2️⃣ Testing batch template loading with getMessageTemplatesBatch()...')
  
  const batchRequests = [
    { eventId: testEventId, templateType: 'bookingConfirmation' },
    { eventId: testEventId, templateType: 'dayBeforeReminder' },
    { eventId: testEventId, templateType: 'booking_reminder_24_hour' }
  ]

  const batchResults = await getMessageTemplatesBatch(batchRequests)
  
  console.log(`\n  Loaded ${batchResults.size} templates in batch:`)
  for (const [key, template] of batchResults) {
    console.log(`  - ${key}: ${template ? '✅ Loaded' : '❌ Not found'}`)
    if (template) {
      console.log(`    📝 ${template.substring(0, 60)}...`)
    }
  }

  console.log('\n✅ Template loading tests complete!')
}

// Run the test
testTemplateLoading().catch(console.error)