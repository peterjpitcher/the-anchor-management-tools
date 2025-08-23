#!/usr/bin/env tsx

/**
 * Script to check what templates are in production database
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables
config({ path: resolve(__dirname, '../.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkProductionTemplates() {
  console.log('🔍 Checking production templates...\n')

  // Check all message templates
  const { data: templates, error: templatesError } = await supabase
    .from('message_templates')
    .select('*')
    .in('template_type', ['booking_confirmation', 'booking_reminder_confirmation'])
    .order('template_type')

  if (templatesError) {
    console.error('❌ Error loading templates:', templatesError)
    return
  }

  console.log('📋 Templates for booking confirmations:')
  console.log('=====================================\n')
  
  templates?.forEach(t => {
    console.log(`Template: ${t.name}`)
    console.log(`- ID: ${t.id}`)
    console.log(`- Type: ${t.template_type}`)
    console.log(`- Default: ${t.is_default}`)
    console.log(`- Active: ${t.is_active}`)
    console.log(`- Content: ${t.content}`)
    console.log('---')
  })

  // Test the RPC function with a dummy event ID
  console.log('\n\n🧪 Testing RPC function:')
  console.log('========================\n')
  
  const testEventId = '00000000-0000-0000-0000-000000000000'
  const testTypes = ['booking_confirmation', 'booking_reminder_confirmation']
  
  for (const type of testTypes) {
    console.log(`\nTesting ${type}:`)
    const { data, error } = await supabase
      .rpc('get_message_template', {
        p_event_id: testEventId,
        p_template_type: type
      })
      .single()

    if (error) {
      console.log(`❌ Error: ${error.message}`)
    } else if (data) {
      console.log(`✅ Found template`)
      console.log(`- Content: ${data.content}`)
      console.log(`- Variables: ${data.variables?.join(', ')}`)
    } else {
      console.log(`❌ No template returned`)
    }
  }

  // Check if there are any event-specific templates
  console.log('\n\n📋 Event-specific templates:')
  console.log('===========================\n')
  
  const { data: eventTemplates, error: eventError } = await supabase
    .from('event_message_templates')
    .select('event_id, template_type, content, is_active')
    .in('template_type', ['booking_confirmation', 'booking_reminder_confirmation'])
    .limit(10)

  if (eventError) {
    console.error('❌ Error loading event templates:', eventError)
  } else if (eventTemplates && eventTemplates.length > 0) {
    eventTemplates.forEach(t => {
      console.log(`Event ${t.event_id}: ${t.template_type} (active: ${t.is_active})`)
    })
  } else {
    console.log('No event-specific templates found')
  }

  console.log('\n✅ Check complete!')
}

// Run the check
checkProductionTemplates().catch(console.error)