import { getSupabaseAdminClient } from '../src/lib/supabase-singleton'

async function checkAuditLogs() {
  try {
    const supabase = getSupabaseAdminClient()
    
    // Query audit logs for employees
    const { data: logs, error } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('resource_type', 'employee')
      .order('created_at', { ascending: false })
      .limit(10)

    if (error) {
      console.error('Error querying audit logs:', error)
      return
    }

    console.log(`Found ${logs?.length || 0} employee audit logs:\n`)
    
    if (logs && logs.length > 0) {
      logs.forEach((log, i) => {
        console.log(`Log ${i + 1}:`)
        console.log(`  ID: ${log.id}`)
        console.log(`  Operation: ${log.operation_type}`)
        console.log(`  Resource: ${log.resource_type}`)
        console.log(`  Resource ID: ${log.resource_id}`)
        console.log(`  User: ${log.user_email || 'System'}`)
        console.log(`  Status: ${log.operation_status}`)
        console.log(`  Created: ${new Date(log.created_at).toLocaleString()}`)
        if (log.additional_info) {
          console.log(`  Additional Info:`, JSON.stringify(log.additional_info, null, 2))
        }
        console.log('---')
      })
    } else {
      console.log('No audit logs found for employees')
    }

  } catch (error) {
    console.error('Unexpected error:', error)
  }
}

checkAuditLogs()