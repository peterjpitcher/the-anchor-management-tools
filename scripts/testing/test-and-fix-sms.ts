import { createAdminClient } from '@/lib/supabase/server'
import { jobQueue } from '@/lib/background-jobs'
import { sendSMS } from '@/lib/twilio'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function testAndFixSMS() {
  console.log('🔍 SMS System Diagnostic and Fix Tool\n')
  
  const supabase = await createAdminClient()
  
  // 1. Check environment variables
  console.log('1️⃣ Checking Environment Variables...')
  const requiredEnvVars = {
    'TWILIO_ACCOUNT_SID': process.env.TWILIO_ACCOUNT_SID,
    'TWILIO_AUTH_TOKEN': process.env.TWILIO_AUTH_TOKEN,
    'TWILIO_PHONE_NUMBER': process.env.TWILIO_PHONE_NUMBER,
    'NEXT_PUBLIC_CONTACT_PHONE_NUMBER': process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER,
    'CRON_SECRET': process.env.CRON_SECRET,
  }
  
  let envOk = true
  for (const [key, value] of Object.entries(requiredEnvVars)) {
    if (!value) {
      console.log(`❌ ${key} is missing`)
      envOk = false
    } else {
      console.log(`✅ ${key} is set (${key.includes('SECRET') || key.includes('TOKEN') ? '***' : value})`)
    }
  }
  
  if (!envOk) {
    console.log('\n⚠️  Missing environment variables. Please set them in .env.local')
    return
  }
  
  // 2. Check for pending SMS jobs
  console.log('\n2️⃣ Checking Pending SMS Jobs...')
  const { data: pendingJobs, error: jobError } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'send_sms')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(10)
    
  if (jobError) {
    console.error('❌ Error fetching jobs:', jobError)
    return
  }
  
  console.log(`Found ${pendingJobs?.length || 0} pending SMS jobs`)
  
  if (pendingJobs && pendingJobs.length > 0) {
    console.log('\nPending jobs:')
    pendingJobs.forEach((job, index) => {
      console.log(`${index + 1}. Job ID: ${job.id}`)
      console.log(`   Created: ${new Date(job.created_at).toLocaleString()}`)
      console.log(`   Payload: ${JSON.stringify(job.payload, null, 2)}`)
    })
  }
  
  // 3. Check SMS templates
  console.log('\n3️⃣ Checking SMS Templates...')
  const { data: templates, error: templateError } = await supabase
    .from('table_booking_sms_templates')
    .select('*')
    .eq('is_active', true)
    
  if (templateError) {
    console.error('❌ Error fetching templates:', templateError)
  } else {
    console.log(`✅ Found ${templates?.length || 0} active SMS templates`)
    templates?.forEach(t => {
      console.log(`   - ${t.template_key} (${t.booking_type || 'all'})`)
    })
  }
  
  // 4. Check recent table bookings
  console.log('\n4️⃣ Checking Recent Table Bookings...')
  const { data: recentBookings, error: bookingError } = await supabase
    .from('table_bookings')
    .select(`
      id,
      booking_reference,
      customer_name,
      customer_phone,
      status,
      created_at
    `)
    .order('created_at', { ascending: false })
    .limit(5)
    
  if (bookingError) {
    console.error('❌ Error fetching bookings:', bookingError)
  } else {
    console.log(`Recent bookings:`)
    recentBookings?.forEach((b, i) => {
      console.log(`${i + 1}. ${b.booking_reference} - ${b.customer_name} (${b.status}) - ${new Date(b.created_at).toLocaleString()}`)
    })
  }
  
  // 5. Test Twilio connection
  console.log('\n5️⃣ Testing Twilio Connection...')
  try {
    // Test with a simple message to see if Twilio is configured correctly
    console.log('Attempting to validate Twilio credentials...')
    const { twilioClient } = await import('@/lib/twilio')
    const account = await twilioClient.api.accounts(process.env.TWILIO_ACCOUNT_SID!).fetch()
    console.log(`✅ Twilio account active: ${account.friendlyName}`)
    console.log(`   Status: ${account.status}`)
  } catch (error: any) {
    console.error('❌ Twilio connection failed:', error.message)
    return
  }
  
  // 6. Process pending jobs
  if (pendingJobs && pendingJobs.length > 0) {
    console.log('\n6️⃣ Processing Pending Jobs...')
    const processChoice = await askQuestion('Process pending jobs now? (y/n): ')
    
    if (processChoice.toLowerCase() === 'y') {
      console.log('Processing jobs...')
      try {
        await jobQueue.processJobs(pendingJobs.length)
        console.log('✅ Jobs processed successfully')
        
        // Check results
        const { data: processedJobs } = await supabase
          .from('jobs')
          .select('*')
          .in('id', pendingJobs.map(j => j.id))
          
        processedJobs?.forEach(job => {
          console.log(`Job ${job.id}: ${job.status}`)
          if (job.error_message) {
            console.log(`   Error: ${job.error_message}`)
          }
        })
      } catch (error) {
        console.error('❌ Error processing jobs:', error)
      }
    }
  }
  
  // 7. Create a test SMS job
  console.log('\n7️⃣ Test SMS Sending...')
  const testChoice = await askQuestion('Create a test SMS job? (y/n): ')
  
  if (testChoice.toLowerCase() === 'y') {
    const testPhone = await askQuestion('Enter test phone number (with country code, e.g., +447123456789): ')
    
    if (testPhone) {
      console.log('Creating test job...')
      try {
        const jobId = await jobQueue.enqueue('send_sms', {
          to: testPhone,
          message: `Test SMS from Anchor Management at ${new Date().toLocaleString()}. If you received this, SMS is working!`,
          customer_id: null,
        })
        
        console.log(`✅ Test job created with ID: ${jobId}`)
        console.log('Processing test job...')
        
        await jobQueue.processJobs(1)
        
        // Check result
        const { data: testJob } = await supabase
          .from('jobs')
          .select('*')
          .eq('id', jobId)
          .single()
          
        if (testJob?.status === 'completed') {
          console.log('✅ Test SMS sent successfully!')
        } else {
          console.log(`❌ Test SMS failed: ${testJob?.error_message || 'Unknown error'}`)
        }
      } catch (error) {
        console.error('❌ Error sending test SMS:', error)
      }
    }
  }
  
  // 8. Check cron job logs
  console.log('\n8️⃣ Checking Job Processing History...')
  const { data: recentJobs } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'send_sms')
    .order('updated_at', { ascending: false })
    .limit(10)
    
  const statusCounts = recentJobs?.reduce((acc, job) => {
    acc[job.status] = (acc[job.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  
  console.log('Recent job statuses:')
  Object.entries(statusCounts || {}).forEach(([status, count]) => {
    console.log(`   ${status}: ${count}`)
  })
  
  // Summary and recommendations
  console.log('\n📊 Summary and Recommendations:')
  console.log('================================')
  
  if (pendingJobs && pendingJobs.length > 0) {
    console.log(`⚠️  You have ${pendingJobs.length} pending SMS jobs that haven't been processed.`)
    console.log('   This suggests the cron job is not running properly.')
    console.log('\n   Recommendations:')
    console.log('   1. Check Vercel Functions logs for /api/jobs/process')
    console.log('   2. Verify CRON_SECRET is set in Vercel environment variables')
    console.log('   3. Check if Vercel cron jobs are enabled for your project')
    console.log('   4. Manually trigger: curl -X POST https://management.orangejelly.co.uk/api/jobs/process -H "Authorization: Bearer YOUR_CRON_SECRET"')
  }
  
  console.log('\n✅ SMS system components are properly configured.')
  console.log('   The issue is likely with the cron job not running.')
}

function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question)
    process.stdin.once('data', (data) => {
      resolve(data.toString().trim())
    })
  })
}

// Enable stdin for interactive mode
process.stdin.resume()
process.stdin.setEncoding('utf8')

testAndFixSMS()
  .then(() => {
    console.log('\n✅ Diagnostic complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Error:', error)
    process.exit(1)
  })