import { createAdminClient } from '../src/lib/supabase/server'

async function testAuditLog() {
  try {
    const supabase = await createAdminClient()
    
    // Test inserting an audit log entry directly
    const { data, error } = await supabase
      .from('audit_logs')
      .insert({
        user_email: 'test@example.com',
        operation_type: 'update',
        resource_type: 'employee',
        resource_id: '992f7599-91e3-4da5-a4a3-a4334c965868',
        operation_status: 'success',
        additional_info: {
          action: 'update_onboarding_checklist',
          field: 'wheniwork_invite_sent',
          checked: true
        }
      })
      .select()
      .single()

    if (error) {
      console.error('Error inserting audit log:', error)
    } else {
      console.log('Successfully inserted audit log:', data)
    }

    // Now query audit logs for this employee
    const { data: logs, error: queryError } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('resource_type', 'employee')
      .eq('resource_id', '992f7599-91e3-4da5-a4a3-a4334c965868')
      .order('created_at', { ascending: false })
      .limit(5)

    if (queryError) {
      console.error('Error querying audit logs:', queryError)
    } else {
      console.log(`Found ${logs?.length || 0} audit logs for employee`)
      logs?.forEach((log, i) => {
        console.log(`\nLog ${i + 1}:`)
        console.log(`  Operation: ${log.operation_type}`)
        console.log(`  User: ${log.user_email || 'System'}`)
        console.log(`  Status: ${log.operation_status}`)
        console.log(`  Created: ${log.created_at}`)
        if (log.additional_info) {
          console.log(`  Additional Info:`, log.additional_info)
        }
      })
    }

  } catch (error) {
    console.error('Unexpected error:', error)
  }
}

testAuditLog()