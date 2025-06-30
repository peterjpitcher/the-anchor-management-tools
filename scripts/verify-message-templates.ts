#!/usr/bin/env tsx

/**
 * Script to verify and ensure default message templates are properly configured
 * This ensures that SMS messages use the defined templates instead of fallback hard-coded messages
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

// Default templates for each type
const DEFAULT_TEMPLATES = {
  booking_confirmation: {
    name: 'Standard Booking Confirmation',
    content: 'Hi {{first_name}}, your booking for {{seats}} people for our {{event_name}} on {{event_date}} at {{event_time}} is confirmed! See you then. {{venue_name}} {{contact_phone}}',
    description: 'Sent immediately when a customer books seats for an event'
  },
  booking_reminder_confirmation: {
    name: 'Reminder-Only Confirmation',
    content: "Hi {{first_name}}, don't forget, we've got our {{event_name}} on {{event_date}} at {{event_time}}! Let us know if you want to book seats. {{venue_name}} {{contact_phone}}",
    description: 'Sent when a customer signs up for event reminders (0 seats)'
  },
  reminder_24_hour: {
    name: '24-Hour Event Reminder',
    content: 'Hi {{first_name}}, just a reminder that our {{event_name}} is tomorrow at {{event_time}} and you have {{seats}} seats booked. See you tomorrow! {{venue_name}} {{contact_phone}}',
    description: 'Sent 24 hours before the event to customers with bookings'
  },
  reminder_7_day: {
    name: '7-Day Event Reminder', 
    content: 'Hi {{first_name}}, just a reminder that our {{event_name}} is next week on {{event_date}} at {{event_time}} and you have {{seats}} seats booked. See you here! {{venue_name}} {{contact_phone}}',
    description: 'Sent 7 days before the event to customers with bookings'
  },
  booking_reminder_24_hour: {
    name: '24-Hour Reminder (No Seats)',
    content: 'Hi {{first_name}}, just a reminder that our {{event_name}} is tomorrow at {{event_time}}. See you tomorrow! {{venue_name}} {{contact_phone}}',
    description: 'Sent 24 hours before the event to customers with reminders only'
  },
  booking_reminder_7_day: {
    name: '7-Day Reminder (No Seats)',
    content: 'Hi {{first_name}}, just a reminder that our {{event_name}} is next week on {{event_date}} at {{event_time}}. See you here! {{venue_name}} {{contact_phone}}',
    description: 'Sent 7 days before the event to customers with reminders only'
  }
}

async function verifyAndSetDefaultTemplates() {
  console.log('🔍 Checking message templates...\n')

  try {
    // First, get all existing templates
    const { data: existingTemplates, error: fetchError } = await supabase
      .from('message_templates')
      .select('*')
      .order('template_type')

    if (fetchError) {
      console.error('❌ Error fetching templates:', fetchError)
      return
    }

    console.log(`📊 Found ${existingTemplates?.length || 0} existing templates\n`)

    // Check each template type
    for (const [templateType, templateData] of Object.entries(DEFAULT_TEMPLATES)) {
      console.log(`\n📋 Checking ${templateType}...`)
      
      const existing = existingTemplates?.filter(t => t.template_type === templateType) || []
      const defaultTemplate = existing.find(t => t.is_default)
      const activeTemplates = existing.filter(t => t.is_active)

      console.log(`   - Total templates: ${existing.length}`)
      console.log(`   - Active templates: ${activeTemplates.length}`)
      console.log(`   - Default template: ${defaultTemplate ? '✅ Yes' : '❌ No'}`)

      if (!defaultTemplate) {
        // No default template exists, create one
        console.log(`   ⚠️  No default template found for ${templateType}`)
        
        const { data: newTemplate, error: insertError } = await supabase
          .from('message_templates')
          .insert({
            name: templateData.name,
            description: templateData.description,
            template_type: templateType,
            content: templateData.content,
            is_default: true,
            is_active: true,
            variables: extractVariables(templateData.content)
          })
          .select()
          .single()

        if (insertError) {
          console.error(`   ❌ Error creating default template:`, insertError)
        } else {
          console.log(`   ✅ Created default template: ${newTemplate.name}`)
        }
      } else {
        console.log(`   ✅ Default template exists: ${defaultTemplate.name}`)
        
        // Check if it's active
        if (!defaultTemplate.is_active) {
          console.log(`   ⚠️  Default template is inactive, activating...`)
          
          const { error: updateError } = await supabase
            .from('message_templates')
            .update({ is_active: true })
            .eq('id', defaultTemplate.id)

          if (updateError) {
            console.error(`   ❌ Error activating template:`, updateError)
          } else {
            console.log(`   ✅ Activated default template`)
          }
        }
      }
    }

    // Summary report
    console.log('\n\n📊 Summary Report:')
    console.log('==================')
    
    const { data: finalTemplates } = await supabase
      .from('message_templates')
      .select('template_type, name, is_default, is_active')
      .order('template_type')

    const templateTypes = Object.keys(DEFAULT_TEMPLATES)
    
    for (const type of templateTypes) {
      const templates = finalTemplates?.filter(t => t.template_type === type) || []
      const defaultTemplate = templates.find(t => t.is_default && t.is_active)
      
      console.log(`\n${type}:`)
      if (defaultTemplate) {
        console.log(`  ✅ Default: ${defaultTemplate.name}`)
      } else {
        console.log(`  ❌ No active default template`)
      }
      console.log(`  Total templates: ${templates.length}`)
    }

    // Test the RPC function
    console.log('\n\n🧪 Testing get_message_template RPC function...')
    
    // Get a random event to test with
    const { data: sampleEvent } = await supabase
      .from('events')
      .select('id, name')
      .limit(1)
      .single()

    if (sampleEvent) {
      console.log(`\nTesting with event: ${sampleEvent.name}`)
      
      for (const templateType of ['booking_confirmation', 'reminder_24_hour']) {
        const { data: templateResult, error: rpcError } = await supabase
          .rpc('get_message_template', {
            p_event_id: sampleEvent.id,
            p_template_type: templateType
          })
          .single<{ content: string; variables: string[]; send_timing: string; custom_timing_hours: number | null }>()

        if (rpcError) {
          console.log(`  ❌ ${templateType}: Error - ${rpcError.message}`)
        } else if (templateResult?.content) {
          console.log(`  ✅ ${templateType}: Found template (${templateResult.content.substring(0, 50)}...)`)
        } else {
          console.log(`  ❌ ${templateType}: No template found`)
        }
      }
    }

    console.log('\n✅ Template verification complete!')

  } catch (error) {
    console.error('❌ Unexpected error:', error)
  }
}

function extractVariables(content: string): string[] {
  const matches = content.match(/{{(\w+)}}/g) || []
  const variables = matches.map(match => match.replace(/[{}]/g, ''))
  return [...new Set(variables)]
}

// Run the verification
verifyAndSetDefaultTemplates()