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

async function checkSmsTemplates() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-sms-templates is strictly read-only; do not pass --confirm.')
  }

  const supabase = createAdminClient()

  console.log('📱 Checking SMS Templates\n')
  console.log('='.repeat(60))

  const { data: templatesRows, error } = await supabase
    .from('table_booking_sms_templates')
    .select('template_key, booking_type, is_active, template_text, variables')
    .order('template_key', { ascending: true })

  const templates = (assertScriptQuerySucceeded({
    operation: 'Load table_booking_sms_templates',
    error,
    data: templatesRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    template_key: string | null
    booking_type: string | null
    is_active: boolean | null
    template_text: string | null
    variables: string[] | null
  }>

  if (templates.length === 0) {
    markFailure('No SMS templates found in table_booking_sms_templates (0 rows).')
  } else {
    console.log(`Found ${templates.length} template(s):\n`)

    for (const template of templates) {
      console.log(`📝 Template: ${template.template_key || 'unknown'}`)
      console.log(`   Type: ${template.booking_type || 'all'}`)
      console.log(`   Active: ${template.is_active ? '✅' : '❌'}`)
      console.log(`   Text: ${(template.template_text || '').substring(0, 200)}${(template.template_text || '').length > 200 ? '...' : ''}`)
      console.log(`   Variables: ${Array.isArray(template.variables) ? template.variables.join(', ') : 'none'}`)
      console.log('')
    }
  }

  const paymentTemplate = templates.find((t) => t.template_key === 'payment_request')
  if (paymentTemplate) {
    console.log('✅ payment_request template exists')
    console.log(`   Content preview: ${(paymentTemplate.template_text || '').substring(0, 200)}${(paymentTemplate.template_text || '').length > 200 ? '...' : ''}`)
  } else {
    markFailure('No payment_request template found (expected template_key=payment_request).')
  }

  if (process.exitCode === 1) {
    console.log('\n❌ SMS templates check completed with failures.')
  } else {
    console.log('\n✅ SMS templates check complete!')
  }
}

void checkSmsTemplates().catch((error) => {
  markFailure('check-sms-templates failed.', error)
})

