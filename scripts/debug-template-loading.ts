#!/usr/bin/env tsx

/**
 * Debug script to trace template loading issues
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'
import { getMessageTemplate } from '../src/lib/smsTemplates'

// Load environment variables
config({ path: resolve(__dirname, '../.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Template type mapping from smsTemplates.ts
const TEMPLATE_TYPE_MAP: Record<string, string> = {
  bookingConfirmation: 'booking_confirmation',
  weekBeforeReminder: 'reminder_7_day', 
  dayBeforeReminder: 'reminder_24_hour',
  reminderOnly: 'booking_reminder_confirmation',
  booking_reminder_24_hour: 'booking_reminder_24_hour',
  booking_reminder_7_day: 'booking_reminder_7_day'
};

async function debugTemplateLoading() {
  console.log('🔍 Debugging template loading...\n')

  // Step 1: Check what templates exist in the database
  console.log('1️⃣ Checking templates in database...')
  
  const { data: templates, error: templatesError } = await supabase
    .from('message_templates')
    .select('id, name, template_type, is_default, is_active, content')
    .order('template_type')

  if (templatesError) {
    console.error('❌ Error loading templates:', templatesError)
    return
  }

  console.log('\n📋 Global Templates:')
  templates?.forEach(t => {
    console.log(`  - ${t.template_type}: ${t.name}`)
    console.log(`    Default: ${t.is_default}, Active: ${t.is_active}`)
    console.log(`    Content preview: ${t.content.substring(0, 50)}...`)
  })

  // Step 2: Get a sample event to test with
  const { data: sampleEvent } = await supabase
    .from('events')
    .select('id, name')
    .limit(1)
    .single()

  if (!sampleEvent) {
    console.error('❌ No events found to test with')
    return
  }

  console.log(`\n2️⃣ Testing with event: ${sampleEvent.name} (${sampleEvent.id})`)

  // Step 3: Test the RPC function directly
  console.log('\n3️⃣ Testing RPC function directly...')
  
  const templateTypesToTest = ['booking_confirmation', 'booking_reminder_confirmation']
  
  for (const templateType of templateTypesToTest) {
    console.log(`\n  Testing ${templateType}:`)
    
    const { data: rpcResult, error: rpcError } = await supabase
      .rpc('get_message_template', {
        p_event_id: sampleEvent.id,
        p_template_type: templateType
      })
      .single()

    if (rpcError) {
      console.log(`  ❌ RPC Error: ${rpcError.message}`)
    } else if (rpcResult) {
      console.log(`  ✅ RPC returned: ${JSON.stringify(rpcResult, null, 2)}`)
    } else {
      console.log(`  ❌ RPC returned null`)
    }
  }

  // Step 4: Test the getMessageTemplate function
  console.log('\n4️⃣ Testing getMessageTemplate function...')
  
  const testVariables = {
    customer_name: 'Test Customer',
    first_name: 'Test',
    event_name: 'Test Event',
    event_date: '25th December',
    event_time: '7:00 PM',
    seats: '2',
    venue_name: 'The Anchor',
    contact_phone: '01753682707',
    booking_reference: 'TEST-123'
  }

  // Test the actual template types used in sendBookingConfirmationSync
  const smsTemplateTypes = ['bookingConfirmation', 'reminderOnly']
  
  for (const templateType of smsTemplateTypes) {
    console.log(`\n  Testing ${templateType}:`)
    console.log(`  Maps to: ${TEMPLATE_TYPE_MAP[templateType] || templateType}`)
    
    const template = await getMessageTemplate(sampleEvent.id, templateType, testVariables)
    
    if (template) {
      console.log(`  ✅ Template loaded: ${template.substring(0, 80)}...`)
    } else {
      console.log(`  ❌ Template not found - will fall back to hard-coded template`)
    }
  }

  // Step 5: Check event-specific templates
  console.log('\n5️⃣ Checking event-specific templates...')
  
  const { data: eventTemplates, error: eventTemplatesError } = await supabase
    .from('event_message_templates')
    .select('event_id, template_type, content, is_active')
    .eq('event_id', sampleEvent.id)

  if (eventTemplatesError) {
    console.error('❌ Error loading event templates:', eventTemplatesError)
  } else if (eventTemplates && eventTemplates.length > 0) {
    console.log('\n📋 Event-specific templates:')
    eventTemplates.forEach(t => {
      console.log(`  - ${t.template_type}: Active: ${t.is_active}`)
      console.log(`    Content: ${t.content.substring(0, 50)}...`)
    })
  } else {
    console.log('  No event-specific templates found')
  }

  // Step 6: Test a simulated booking confirmation flow
  console.log('\n6️⃣ Simulating booking confirmation flow...')
  
  const bookingScenarios = [
    { seats: 2, expectedType: 'bookingConfirmation', description: 'Booking with seats' },
    { seats: 0, expectedType: 'reminderOnly', description: 'Reminder only (0 seats)' }
  ]

  for (const scenario of bookingScenarios) {
    console.log(`\n  ${scenario.description}:`)
    console.log(`  Template type: ${scenario.expectedType}`)
    
    const template = await getMessageTemplate(sampleEvent.id, scenario.expectedType, {
      ...testVariables,
      seats: scenario.seats.toString()
    })
    
    if (template) {
      console.log(`  ✅ Would use database template: ${template.substring(0, 60)}...`)
    } else {
      console.log(`  ❌ Would fall back to hard-coded template`)
    }
  }

  console.log('\n✅ Debug complete!')
}

// Run the debug script
debugTemplateLoading().catch(console.error)