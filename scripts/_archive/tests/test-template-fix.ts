#!/usr/bin/env tsx

/**
 * Test script to verify SMS template loading with and without eventId
 */

import { getMessageTemplate } from '../src/lib/smsTemplates'
import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables
config({ path: resolve(__dirname, '../.env.local') })

async function testTemplateFix() {
  console.log('🧪 Testing SMS template loading fix...\n')

  const testVariables = {
    customer_name: 'Test Customer',
    first_name: 'Test',
    event_name: 'Quiz Night',
    event_date: '2nd July',
    event_time: '7:00 PM',
    seats: '0',
    venue_name: 'The Anchor',
    contact_phone: '01753682707',
    booking_reference: 'TEST-123'
  }

  // Test 1: With undefined eventId (should use global template)
  console.log('Test 1: Loading template with undefined eventId')
  console.log('================================================')
  const result1 = await getMessageTemplate(undefined, 'reminderOnly', testVariables)
  console.log('Result:', result1)
  console.log('\n')

  // Test 2: With null eventId (should use global template)
  console.log('Test 2: Loading template with null eventId')
  console.log('==========================================')
  const result2 = await getMessageTemplate(null as any, 'reminderOnly', testVariables)
  console.log('Result:', result2)
  console.log('\n')

  // Test 3: With valid eventId (should try event-specific first)
  console.log('Test 3: Loading template with valid eventId')
  console.log('===========================================')
  const result3 = await getMessageTemplate('35fa3e92-dacd-43ee-948b-3f7610f0fe6a', 'reminderOnly', testVariables)
  console.log('Result:', result3)
  console.log('\n')

  // Test 4: Test booking confirmation template
  console.log('Test 4: Loading booking confirmation template')
  console.log('=============================================')
  testVariables.seats = '2'
  const result4 = await getMessageTemplate(undefined, 'bookingConfirmation', testVariables)
  console.log('Result:', result4)
  console.log('\n')

  // Summary
  console.log('📊 Summary:')
  console.log('===========')
  console.log(`Test 1 (undefined eventId): ${result1 ? '✅ Success' : '❌ Failed'}`)
  console.log(`Test 2 (null eventId): ${result2 ? '✅ Success' : '❌ Failed'}`)
  console.log(`Test 3 (valid eventId): ${result3 ? '✅ Success' : '❌ Failed'}`)
  console.log(`Test 4 (booking confirmation): ${result4 ? '✅ Success' : '❌ Failed'}`)
}

// Run the test
testTemplateFix().catch(console.error)