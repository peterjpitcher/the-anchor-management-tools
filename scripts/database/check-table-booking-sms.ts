import { createAdminClient } from '../src/lib/supabase/server'

async function checkTableBookingSMS() {
  const supabase = createAdminClient()
  
  console.log('=== Checking Table Booking SMS Flow ===\n')
  
  // 1. Check SMS templates
  console.log('1. Checking SMS Templates:')
  const { data: templates, error: templateError } = await supabase
    .from('table_booking_sms_templates')
    .select('*')
    .eq('is_active', true)
  
  if (templateError) {
    console.error('Error fetching templates:', templateError)
  } else {
    console.log(`Found ${templates?.length || 0} active templates:`)
    templates?.forEach(template => {
      console.log(`  - ${template.template_key} (${template.booking_type || 'all types'})`)
      console.log(`    Template: ${template.template_text.substring(0, 100)}...`)
      console.log(`    Variables: ${template.variables?.join(', ') || 'none'}`)
    })
  }
  
  // 2. Check recent table booking jobs
  console.log('\n2. Recent Table Booking SMS Jobs (last 7 days):')
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  
  const { data: jobs, error: jobsError } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'send_sms')
    .gte('created_at', sevenDaysAgo.toISOString())
    .like('payload', '%table_booking_confirmation%')
    .order('created_at', { ascending: false })
    .limit(10)
  
  if (jobsError) {
    console.error('Error fetching jobs:', jobsError)
  } else {
    console.log(`Found ${jobs?.length || 0} table booking SMS jobs:`)
    jobs?.forEach(job => {
      console.log(`\n  Job ID: ${job.id}`)
      console.log(`  Status: ${job.status}`)
      console.log(`  Created: ${job.created_at}`)
      console.log(`  Payload: ${JSON.stringify(job.payload, null, 2)}`)
      if (job.error_message) {
        console.log(`  Error: ${job.error_message}`)
      }
    })
  }
  
  // 3. Check recent table bookings
  console.log('\n3. Recent Table Bookings (last 7 days):')
  const { data: bookings, error: bookingsError } = await supabase
    .from('table_bookings')
    .select(`
      id,
      booking_reference,
      booking_type,
      status,
      created_at,
      customer:customers(
        id,
        first_name,
        last_name,
        mobile_number,
        sms_opt_in
      )
    `)
    .gte('created_at', sevenDaysAgo.toISOString())
    .order('created_at', { ascending: false })
    .limit(10)
  
  if (bookingsError) {
    console.error('Error fetching bookings:', bookingsError)
  } else {
    console.log(`Found ${bookings?.length || 0} recent bookings:`)
    bookings?.forEach(booking => {
      console.log(`\n  Booking: ${booking.booking_reference}`)
      console.log(`  Type: ${booking.booking_type}, Status: ${booking.status}`)
      console.log(`  Customer: ${booking.customer?.first_name} ${booking.customer?.last_name}`)
      console.log(`  Phone: ${booking.customer?.mobile_number}, Opt-in: ${booking.customer?.sms_opt_in}`)
      console.log(`  Created: ${booking.created_at}`)
    })
  }
  
  // 4. Check if there's a missing template
  console.log('\n4. Checking for missing template:')
  const requiredTemplate = 'table_booking_confirmation'
  const { data: specificTemplate } = await supabase
    .from('table_booking_sms_templates')
    .select('*')
    .eq('template_key', requiredTemplate)
    .single()
  
  if (!specificTemplate) {
    console.log(`\n⚠️  MISSING TEMPLATE: '${requiredTemplate}' not found!`)
    console.log('This is likely why SMS are not being sent.')
    console.log('\nCreating default template...')
    
    const { error: createError } = await supabase
      .from('table_booking_sms_templates')
      .insert({
        template_key: requiredTemplate,
        template_text: 'Hi {{customer_name}}, your table booking for {{party_size}} people on {{date}} at {{time}} has been confirmed. Reference: {{reference}}. If you need to make any changes, please call us on {{contact_phone}}. The Anchor',
        variables: ['customer_name', 'party_size', 'date', 'time', 'reference', 'contact_phone'],
        is_active: true
      })
    
    if (createError) {
      console.error('Error creating template:', createError)
    } else {
      console.log('✅ Default template created successfully!')
    }
  } else {
    console.log(`✅ Template '${requiredTemplate}' exists and is ${specificTemplate.is_active ? 'active' : 'inactive'}`)
  }
  
  // 5. Check messages table for recent SMS
  console.log('\n5. Recent SMS Messages (last 7 days):')
  const { data: messages, error: messagesError } = await supabase
    .from('messages')
    .select('*')
    .eq('direction', 'outbound')
    .gte('created_at', sevenDaysAgo.toISOString())
    .like('body', '%table booking%')
    .order('created_at', { ascending: false })
    .limit(5)
  
  if (messagesError) {
    console.error('Error fetching messages:', messagesError)
  } else {
    console.log(`Found ${messages?.length || 0} table booking SMS messages:`)
    messages?.forEach(msg => {
      console.log(`\n  Message ID: ${msg.id}`)
      console.log(`  To: ${msg.to_number}`)
      console.log(`  Status: ${msg.status}`)
      console.log(`  Body: ${msg.body?.substring(0, 100)}...`)
      console.log(`  Created: ${msg.created_at}`)
    })
  }
  
  // 6. Test job processing endpoint
  console.log('\n6. Job Processing Status:')
  const { count: pendingCount } = await supabase
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
    .eq('type', 'send_sms')
  
  console.log(`Pending SMS jobs: ${pendingCount || 0}`)
  
  if (pendingCount && pendingCount > 0) {
    console.log('\n⚠️  There are pending SMS jobs that haven\'t been processed!')
    console.log('This suggests the job processor might not be running.')
  }
}

checkTableBookingSMS().catch(console.error)