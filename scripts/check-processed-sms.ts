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

async function checkProcessedSMS() {
  console.log('📱 Checking Processed SMS Jobs for Recent Bookings\n');
  
  try {
    // Get the two recent bookings
    const bookingRefs = ['TB-2025-3102', 'TB-2025-9837'];
    
    for (const ref of bookingRefs) {
      console.log(`\n🔍 Checking ${ref}`);
      console.log('-'.repeat(40));
      
      // Get booking details
      const { data: booking } = await supabase
        .from('table_bookings')
        .select('id, customer_id, created_at, status')
        .eq('booking_reference', ref)
        .single();
        
      if (!booking) {
        console.log('Booking not found');
        continue;
      }
      
      console.log(`Booking ID: ${booking.id}`);
      console.log(`Customer ID: ${booking.customer_id}`);
      console.log(`Status: ${booking.status}`);
      
      // Check ALL jobs for this booking (not just pending)
      const { data: allJobs } = await supabase
        .from('jobs')
        .select('*')
        .eq('type', 'send_sms')
        .or(`payload->booking_id.eq.${booking.id},payload->customer_id.eq.${booking.customer_id}`)
        .order('created_at', { ascending: false });
        
      if (allJobs && allJobs.length > 0) {
        console.log(`\nFound ${allJobs.length} SMS jobs:`);
        allJobs.forEach(job => {
          console.log(`  Job ${job.id.substring(0, 8)}...`);
          console.log(`    Status: ${job.status}`);
          console.log(`    Created: ${new Date(job.created_at).toLocaleString()}`);
          if (job.completed_at) {
            console.log(`    Completed: ${new Date(job.completed_at).toLocaleString()}`);
          }
          if (job.payload?.template) {
            console.log(`    Template: ${job.payload.template}`);
          }
          if (job.error_message) {
            console.log(`    Error: ${job.error_message}`);
          }
        });
      } else {
        console.log('❌ No SMS jobs found for this booking');
      }
      
      // Check messages table directly
      const { data: messages } = await supabase
        .from('messages')
        .select('*')
        .eq('customer_id', booking.customer_id)
        .gte('created_at', booking.created_at)
        .order('created_at', { ascending: false });
        
      if (messages && messages.length > 0) {
        console.log(`\n📨 Messages in database:`);
        messages.forEach(msg => {
          const isRelevant = msg.body?.includes(ref) || 
                           msg.metadata?.booking_id === booking.id ||
                           msg.body?.includes('Sunday Lunch');
          if (isRelevant) {
            console.log(`  Message ${msg.id.substring(0, 8)}...`);
            console.log(`    Status: ${msg.status}/${msg.twilio_status}`);
            console.log(`    Created: ${new Date(msg.created_at).toLocaleString()}`);
            console.log(`    Body preview: "${msg.body.substring(0, 60)}..."`);
          }
        });
      } else {
        console.log('❌ No messages found in database');
      }
    }
    
    // Check if job processor is actually running
    console.log('\n\n📊 JOB PROCESSOR HEALTH CHECK');
    console.log('-'.repeat(40));
    
    const { data: recentJobs } = await supabase
      .from('jobs')
      .select('type, status, created_at, completed_at')
      .eq('status', 'completed')
      .gte('completed_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .order('completed_at', { ascending: false })
      .limit(10);
      
    if (recentJobs && recentJobs.length > 0) {
      console.log(`✅ ${recentJobs.length} jobs completed in last hour`);
      
      // Group by type
      const byType = recentJobs.reduce((acc, job) => {
        acc[job.type] = (acc[job.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      console.log('\nJob types processed:');
      Object.entries(byType).forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });
    } else {
      console.log('⚠️  No jobs completed in last hour - processor may be down');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the check
checkProcessedSMS();