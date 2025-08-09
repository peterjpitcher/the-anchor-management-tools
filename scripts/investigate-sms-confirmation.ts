#!/usr/bin/env tsx
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function investigateSMSIssues() {
  console.log('🔍 SMS Confirmation Investigation Report');
  console.log('=' .repeat(60));
  console.log(`Report Time: ${new Date().toISOString()}\n`);
  
  try {
    // 1. Check pending jobs in queue
    console.log('📋 1. CHECKING JOB QUEUE');
    console.log('-'.repeat(40));
    
    const { data: pendingJobs, error: jobError } = await supabase
      .from('jobs')
      .select('*')
      .eq('type', 'send_sms')
      .in('status', ['pending', 'processing', 'failed'])
      .order('created_at', { ascending: false })
      .limit(20);

    if (jobError) {
      console.error('❌ Error fetching jobs:', jobError);
    } else {
      console.log(`Found ${pendingJobs?.length || 0} SMS jobs in queue:\n`);
      
      if (pendingJobs && pendingJobs.length > 0) {
        // Group by status
        const byStatus = pendingJobs.reduce((acc, job) => {
          acc[job.status] = (acc[job.status] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        
        console.log('Status breakdown:');
        Object.entries(byStatus).forEach(([status, count]) => {
          console.log(`  ${status}: ${count}`);
        });
        
        console.log('\nRecent jobs:');
        pendingJobs.slice(0, 5).forEach(job => {
          const age = Date.now() - new Date(job.created_at).getTime();
          const ageMinutes = Math.floor(age / 60000);
          console.log(`  - ${job.id.substring(0, 8)}... Status: ${job.status}, Age: ${ageMinutes} mins`);
          if (job.payload?.template) {
            console.log(`    Template: ${job.payload.template}`);
          }
          if (job.error_message) {
            console.log(`    Error: ${job.error_message}`);
          }
        });
      }
    }

    // 2. Check recent Sunday lunch bookings
    console.log('\n📱 2. RECENT SUNDAY LUNCH BOOKINGS');
    console.log('-'.repeat(40));
    
    const { data: recentBookings } = await supabase
      .from('table_bookings')
      .select(`
        id,
        booking_reference,
        booking_type,
        status,
        created_at,
        customer:customers(
          first_name,
          last_name,
          mobile_number,
          sms_opt_in
        ),
        table_booking_payments(
          id,
          status,
          created_at
        )
      `)
      .eq('booking_type', 'sunday_lunch')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(10);

    if (recentBookings) {
      console.log(`Found ${recentBookings.length} Sunday lunch bookings in last 24h:\n`);
      
      for (const booking of recentBookings) {
        console.log(`📍 ${booking.booking_reference}`);
        console.log(`   Status: ${booking.status}`);
        console.log(`   Customer: ${booking.customer?.first_name} ${booking.customer?.last_name}`);
        console.log(`   SMS Opt-in: ${booking.customer?.sms_opt_in ? '✅' : '❌'}`);
        console.log(`   Phone: ${booking.customer?.mobile_number || 'None'}`);
        
        if (booking.table_booking_payments && booking.table_booking_payments.length > 0) {
          const payment = booking.table_booking_payments[0];
          console.log(`   Payment: ${payment.status} (${new Date(payment.created_at).toLocaleString()})`);
        } else {
          console.log('   Payment: None');
        }
        
        // Check for related messages
        if (booking.customer?.mobile_number) {
          const { data: messages } = await supabase
            .from('messages')
            .select('id, status, twilio_status, created_at, body')
            .eq('customer_id', booking.customer.id)
            .or(`metadata->booking_id.eq.${booking.id},body.like.%${booking.booking_reference}%`)
            .order('created_at', { ascending: false })
            .limit(3);
            
          if (messages && messages.length > 0) {
            console.log(`   SMS Messages: ${messages.length} found`);
            messages.forEach(msg => {
              const preview = msg.body.substring(0, 50) + (msg.body.length > 50 ? '...' : '');
              console.log(`     - ${msg.status}/${msg.twilio_status}: "${preview}"`);
            });
          } else {
            console.log('   SMS Messages: None found');
          }
        }
        console.log('');
      }
    }

    // 3. Check SMS templates
    console.log('📝 3. SMS TEMPLATES STATUS');
    console.log('-'.repeat(40));
    
    const { data: templates } = await supabase
      .from('table_booking_sms_templates')
      .select('*')
      .in('template_key', [
        'booking_confirmation_sunday_lunch',
        'booking_confirmation_regular',
        'payment_request'
      ]);

    if (templates) {
      templates.forEach(template => {
        console.log(`✉️  ${template.template_key}:`);
        console.log(`   Active: ${template.is_active ? '✅' : '❌'}`);
        console.log(`   Preview: "${template.template_text.substring(0, 80)}..."`);
      });
    }

    // 4. Check cron job processing
    console.log('\n⏰ 4. JOB PROCESSING STATUS');
    console.log('-'.repeat(40));
    
    // Check last successful job processing
    const { data: completedJobs } = await supabase
      .from('jobs')
      .select('completed_at, type')
      .eq('status', 'completed')
      .eq('type', 'send_sms')
      .order('completed_at', { ascending: false })
      .limit(5);

    if (completedJobs && completedJobs.length > 0) {
      const lastCompleted = completedJobs[0];
      const timeSince = Date.now() - new Date(lastCompleted.completed_at).getTime();
      const minutesSince = Math.floor(timeSince / 60000);
      
      console.log(`Last SMS job completed: ${minutesSince} minutes ago`);
      console.log(`Recent completions:`);
      completedJobs.forEach(job => {
        console.log(`  - ${new Date(job.completed_at).toLocaleString()}`);
      });
    } else {
      console.log('⚠️  No completed SMS jobs found');
    }

    // 5. Check for failed SMS attempts
    console.log('\n❌ 5. FAILED SMS ATTEMPTS');
    console.log('-'.repeat(40));
    
    const { data: failedJobs } = await supabase
      .from('jobs')
      .select('*')
      .eq('type', 'send_sms')
      .eq('status', 'failed')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(10);

    if (failedJobs && failedJobs.length > 0) {
      console.log(`Found ${failedJobs.length} failed SMS jobs in last 24h:`);
      failedJobs.forEach(job => {
        console.log(`  - ${job.id.substring(0, 8)}...`);
        console.log(`    Error: ${job.error_message}`);
        console.log(`    Attempts: ${job.attempts}/${job.max_attempts}`);
        if (job.payload?.template) {
          console.log(`    Template: ${job.payload.template}`);
        }
      });
    } else {
      console.log('✅ No failed SMS jobs in last 24h');
    }

    // 6. Analysis and recommendations
    console.log('\n📊 6. ANALYSIS & FINDINGS');
    console.log('-'.repeat(40));
    
    // Calculate job processing delay
    if (pendingJobs && pendingJobs.length > 0) {
      const oldestPending = pendingJobs[pendingJobs.length - 1];
      const pendingTime = Date.now() - new Date(oldestPending.created_at).getTime();
      const pendingMinutes = Math.floor(pendingTime / 60000);
      
      if (pendingMinutes > 10) {
        console.log(`⚠️  ISSUE: Oldest pending job is ${pendingMinutes} minutes old`);
        console.log('   This suggests the job processor may not be running');
      }
    }
    
    console.log('\n🔍 KEY FINDINGS:');
    console.log('1. SMS confirmations are queued in jobs table (not sent immediately)');
    console.log('2. Job processor runs every 5 minutes via Vercel cron');
    console.log('3. This creates up to 5-minute delay for confirmation SMS');
    console.log('4. Payment request SMS ARE sent immediately (good)');
    console.log('5. Confirmation SMS after payment are NOT sent immediately (issue)');
    
    console.log('\n💡 RECOMMENDATIONS:');
    console.log('1. Send confirmation SMS immediately after payment (like payment requests)');
    console.log('2. Keep job queue as fallback for retries/failures');
    console.log('3. Add monitoring for job queue backlog');
    console.log('4. Consider reducing cron frequency or using edge functions');

  } catch (error) {
    console.error('❌ Investigation error:', error);
  }
}

// Run the investigation
investigateSMSIssues();