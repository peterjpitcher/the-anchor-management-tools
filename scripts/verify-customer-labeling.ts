import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

// Load environment variables
config({ path: '.env.local' })

async function verifyCustomerLabeling() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )

  console.log('🔍 Verifying Customer Labeling System\n')

  // Check customer label assignments
  const { data: assignments, error: assignError } = await supabase
    .from('customer_label_assignments')
    .select(`
      id,
      customer:customers!inner(name),
      label:customer_labels!inner(name),
      created_at
    `)
    .order('created_at', { ascending: false })
    .limit(10)

  if (assignError) {
    console.error('Error fetching assignments:', assignError)
    return
  }

  console.log(`📊 Total Customer Label Assignments: ${assignments?.length || 0}\n`)

  // Group by label
  const labelCounts: Record<string, number> = {}
  assignments?.forEach(a => {
    const labelName = a.label.name
    labelCounts[labelName] = (labelCounts[labelName] || 0) + 1
  })

  console.log('📈 Label Distribution:')
  Object.entries(labelCounts).forEach(([label, count]) => {
    console.log(`   ${label}: ${count} customers`)
  })

  console.log('\n📋 Recent Assignments:')
  assignments?.slice(0, 5).forEach(a => {
    console.log(`   - ${a.customer.name} → ${a.label.name} (${new Date(a.created_at).toLocaleString()})`)
  })

  // Check the last cron run
  const { data: auditLogs, error: auditError } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('operation_type', 'cron_apply_labels')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (auditLogs && !auditError) {
    console.log(`\n⏰ Last Cron Run: ${new Date(auditLogs.created_at).toLocaleString()}`)
  }

  console.log('\n✅ Verification complete!')
}

verifyCustomerLabeling()