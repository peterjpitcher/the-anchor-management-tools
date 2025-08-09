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

async function checkWebhookLogs() {
  console.log('📋 Checking Webhook Logs for PayPal Returns\n');
  
  try {
    // Check webhook logs for recent PayPal returns
    const { data: webhookLogs } = await supabase
      .from('webhook_logs')
      .select('*')
      .or('url.like.%/payment/return%,body.like.%PayerID%')
      .gte('created_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(10);
      
    if (webhookLogs && webhookLogs.length > 0) {
      console.log(`Found ${webhookLogs.length} PayPal return webhook logs:\n`);
      
      webhookLogs.forEach(log => {
        console.log(`📝 Log ${log.id.substring(0, 8)}...`);
        console.log(`   Time: ${new Date(log.created_at).toLocaleString()}`);
        console.log(`   URL: ${log.url}`);
        console.log(`   Status: ${log.response_status}`);
        if (log.error_message) {
          console.log(`   Error: ${log.error_message}`);
        }
        if (log.body) {
          try {
            const body = typeof log.body === 'string' ? JSON.parse(log.body) : log.body;
            if (body.booking_id) {
              console.log(`   Booking ID: ${body.booking_id}`);
            }
          } catch (e) {
            // Not JSON
          }
        }
        console.log('');
      });
    } else {
      console.log('No PayPal return webhook logs found');
    }
    
    // Check for any error logs mentioning SMS
    console.log('\n📱 Checking for SMS-related errors in logs:\n');
    
    const { data: errorLogs } = await supabase
      .from('webhook_logs')
      .select('*')
      .or('error_message.like.%SMS%,error_message.like.%sms%,body.like.%queueBooking%')
      .gte('created_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(10);
      
    if (errorLogs && errorLogs.length > 0) {
      console.log(`Found ${errorLogs.length} SMS-related error logs:`);
      errorLogs.forEach(log => {
        console.log(`   - ${new Date(log.created_at).toLocaleString()}: ${log.error_message}`);
      });
    } else {
      console.log('No SMS-related errors in webhook logs');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkWebhookLogs();