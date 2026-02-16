#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

async function checkProductionTemplates() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-production-templates is strictly read-only; do not pass --confirm.')
  }

  const supabase = createAdminClient()

  console.log('🔍 Checking production templates...\n')

  const { data: templatesRows, error: templatesError } = await supabase
    .from('message_templates')
    .select('id, name, template_type, is_default, is_active, content, variables')
    .in('template_type', ['booking_confirmation', 'booking_reminder_confirmation'])
    .order('template_type', { ascending: true })

  const templates = (assertScriptQuerySucceeded({
    operation: 'Load booking confirmation templates',
    error: templatesError,
    data: templatesRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    id: string
    name: string | null
    template_type: string | null
    is_default: boolean | null
    is_active: boolean | null
    content: string | null
    variables: string[] | null
  }>

  console.log('📋 Templates for booking confirmations:')
  console.log('=====================================\n')

  if (templates.length === 0) {
    markFailure('No booking confirmation templates found (message_templates returned 0 rows).')
  }

  for (const t of templates) {
    console.log(`Template: ${t.name || 'unknown'}`)
    console.log(`- ID: ${t.id}`)
    console.log(`- Type: ${t.template_type || 'unknown'}`)
    console.log(`- Default: ${t.is_default ? 'yes' : 'no'}`)
    console.log(`- Active: ${t.is_active ? 'yes' : 'no'}`)
    console.log(`- Variables: ${Array.isArray(t.variables) ? t.variables.join(', ') : 'none'}`)
    console.log(`- Content: ${t.content || ''}`)
    console.log('---')
  }

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
      .maybeSingle()

    if (error) {
      markFailure(`RPC get_message_template failed for template_type='${type}'.`, error)
      continue
    }

    if (!data) {
      markFailure(`RPC get_message_template returned no template for template_type='${type}'.`)
      continue
    }

    const record = data as { content?: string | null; variables?: string[] | null }
    console.log('✅ Found template')
    console.log(`- Content: ${record.content || ''}`)
    console.log(`- Variables: ${Array.isArray(record.variables) ? record.variables.join(', ') : 'none'}`)
  }

  console.log('\n\n📋 Event-specific templates:')
  console.log('===========================\n')

  const { data: eventTemplatesRows, error: eventError } = await supabase
    .from('event_message_templates')
    .select('event_id, template_type, is_active')
    .in('template_type', ['booking_confirmation', 'booking_reminder_confirmation'])
    .limit(10)

  const eventTemplates = (assertScriptQuerySucceeded({
    operation: 'Load event-specific templates',
    error: eventError,
    data: eventTemplatesRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{ event_id: string; template_type: string | null; is_active: boolean | null }>

  if (eventTemplates.length > 0) {
    for (const t of eventTemplates) {
      console.log(`Event ${t.event_id}: ${t.template_type || 'unknown'} (active: ${t.is_active ? 'yes' : 'no'})`)
    }
  } else {
    console.log('No event-specific templates found')
  }

  if (process.exitCode === 1) {
    console.log('\n❌ Check completed with failures.')
  } else {
    console.log('\n✅ Check complete!')
  }
}

void checkProductionTemplates().catch((error) => {
  markFailure('check-production-templates failed.', error)
})
