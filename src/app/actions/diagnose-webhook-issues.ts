'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'

export async function diagnoseWebhookIssues() {
  const canManage = await checkUserPermission('settings', 'manage')
  if (!canManage) {
    return {
      error: 'You do not have permission to run webhook diagnostics',
      issues: [],
      recommendations: [],
    }
  }

  const supabase = createAdminClient()
  const report: any = {
    timestamp: new Date().toISOString(),
    issues: [],
    recommendations: []
  }
  
  try {
    // 1. Check webhook_logs table structure
    console.log('=== WEBHOOK DIAGNOSTIC REPORT ===')
    console.log('Checking webhook_logs table...')
    
    // Try to insert a test record to see what columns exist
    const testLog = {
      webhook_type: 'test',
      status: 'test',
      message_sid: 'test123',
      headers: { test: true },
      body: 'test body',
      params: { test: 'params' },
      from_number: '+447123456789',
      to_number: '+447987654321',
      message_body: 'test message'
    }
    
    const { error: insertError } = await supabase
      .from('webhook_logs')
      .insert(testLog)
    
    if (insertError) {
      console.log('webhook_logs table structure issue:', insertError.message)
      if (insertError.message.includes('column') && insertError.message.includes('does not exist')) {
        report.issues.push('webhook_logs table is missing columns that the application is trying to use')
        report.recommendations.push('Run the migration: 20250622_fix_webhook_logs_table.sql')
      }
    } else {
      // Clean up test record
      await supabase.from('webhook_logs').delete().eq('webhook_type', 'test')
    }
    
    // 2. Check recent webhook logs
    const { data: recentLogs, error: logsError } = await supabase
      .from('webhook_logs')
      .select('webhook_type, status, message_sid, processed_at, error_message')
      .eq('webhook_type', 'twilio')
      .order('processed_at', { ascending: false })
      .limit(20)
    
    if (logsError) {
      console.log('Error fetching webhook logs:', logsError)
      report.issues.push(`Cannot query webhook logs: ${logsError.message}`)
    } else {
      console.log(`Found ${recentLogs?.length || 0} recent webhook logs`)
      
      const errorLogs = recentLogs?.filter(log => 
        log.status === 'error' || 
        log.status === 'exception' || 
        log.status === 'signature_failed'
      ) || []
      
      if (errorLogs.length > 0) {
        report.issues.push(`Found ${errorLogs.length} webhook errors in recent logs`)
        errorLogs.forEach(log => {
          console.log(`  - ${log.status}: ${log.error_message || 'No error message'}`)
        })
      }
      
      // Check for signature failures
      const signatureFailures = recentLogs?.filter(log => log.status === 'signature_failed') || []
      if (signatureFailures.length > 0) {
        report.issues.push('Twilio signature validation is failing')
        report.recommendations.push('Check that TWILIO_AUTH_TOKEN environment variable matches your Twilio account')
        report.recommendations.push('Ensure webhook URL in Twilio console matches your production URL exactly')
      }
    }
    
    // 3. Check messages table
    const { data: recentMessages, error: messagesError } = await supabase
      .from('messages')
      .select('id, direction, customer_id, from_number, to_number, created_at')
      .order('created_at', { ascending: false })
      .limit(10)
    
    if (messagesError) {
      console.log('Error fetching messages:', messagesError)
      report.issues.push(`Cannot query messages: ${messagesError.message}`)
    } else {
      console.log(`Found ${recentMessages?.length || 0} recent messages`)
      
      // Check for inbound messages
      const inboundMessages = recentMessages?.filter(m => m.direction === 'inbound') || []
      if (inboundMessages.length === 0 && recentLogs && recentLogs.length > 0) {
        report.issues.push('Webhooks are being received but no inbound messages are being created')
        report.recommendations.push('Check that webhook processing is creating messages correctly')
      }
    }
    
    // 4. Check for phone number format consistency
    const { data: sampleCustomers, error: customersError } = await supabase
      .from('customers')
      .select('id, mobile_number')
      .limit(50)
    
    if (!customersError && sampleCustomers) {
      const phoneFormats = new Set<string>()
      sampleCustomers.forEach(c => {
        if (c.mobile_number) {
          if (c.mobile_number.startsWith('+44')) phoneFormats.add('+44')
          else if (c.mobile_number.startsWith('44')) phoneFormats.add('44')
          else if (c.mobile_number.startsWith('0')) phoneFormats.add('0')
          else phoneFormats.add('other')
        }
      })
      
      if (phoneFormats.size > 1) {
        report.issues.push('Inconsistent phone number formats in database')
        report.recommendations.push('Standardize all phone numbers to E.164 format (+44...)')
        console.log('Phone format variations found:', Array.from(phoneFormats))
      }
    }
    
    // 5. Check environment variables
    const envChecks = {
      'TWILIO_ACCOUNT_SID': !!process.env.TWILIO_ACCOUNT_SID,
      'TWILIO_AUTH_TOKEN': !!process.env.TWILIO_AUTH_TOKEN,
      'TWILIO_PHONE_NUMBER': !!process.env.TWILIO_PHONE_NUMBER,
      'SKIP_TWILIO_SIGNATURE_VALIDATION': process.env.SKIP_TWILIO_SIGNATURE_VALIDATION
    }
    
    console.log('\nEnvironment variable status:')
    Object.entries(envChecks).forEach(([key, value]) => {
      console.log(`  ${key}: ${value === true ? 'Set' : value === false ? 'Not set' : value}`)
    })
    
    if (!envChecks['TWILIO_AUTH_TOKEN']) {
      report.issues.push('TWILIO_AUTH_TOKEN is not set')
      report.recommendations.push('Set TWILIO_AUTH_TOKEN environment variable for webhook signature validation')
    }
    
    if (envChecks['SKIP_TWILIO_SIGNATURE_VALIDATION'] === 'true') {
      report.issues.push('WARNING: Twilio signature validation is disabled!')
      report.recommendations.push('Remove SKIP_TWILIO_SIGNATURE_VALIDATION from production environment')
    }
    
    // Generate summary
    console.log('\n=== SUMMARY ===')
    console.log(`Issues found: ${report.issues.length}`)
    report.issues.forEach((issue: string) => console.log(`  - ${issue}`))
    
    console.log(`\nRecommendations: ${report.recommendations.length}`)
    report.recommendations.forEach((rec: string) => console.log(`  - ${rec}`))
    
    return report
    
  } catch (error) {
    console.error('Diagnostic error:', error)
    report.error = error instanceof Error ? error.message : 'Unknown error'
    return report
  }
}
