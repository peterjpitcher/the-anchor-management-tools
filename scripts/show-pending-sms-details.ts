#!/usr/bin/env tsx

import { createAdminClient } from '../src/lib/supabase/server';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function showPendingSMS() {
  console.log('📋 PENDING SMS MESSAGES IN QUEUE\n');
  console.log('=' .repeat(80));
  
  const supabase = await createAdminClient();
  
  // Get all pending SMS jobs with full details
  const { data: pendingJobs, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'send_sms')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
    
  if (error) {
    console.error('❌ Error fetching pending jobs:', error);
    return;
  }
  
  if (!pendingJobs || pendingJobs.length === 0) {
    console.log('✅ No pending SMS messages in the queue');
    return;
  }
  
  console.log(`Found ${pendingJobs.length} pending SMS message(s):\n`);
  
  // Show each pending message in detail
  for (let i = 0; i < pendingJobs.length; i++) {
    const job = pendingJobs[i];
    const payload = job.payload as any;
    
    console.log(`📱 Message ${i + 1} of ${pendingJobs.length}`);
    console.log('-'.repeat(40));
    console.log(`Job ID: ${job.id}`);
    console.log(`Created: ${new Date(job.created_at).toLocaleString()}`);
    console.log(`To: ${payload.to}`);
    console.log(`Template: ${payload.template || 'Direct message'}`);
    
    // If it's a template, show the variables
    if (payload.template && payload.variables) {
      console.log(`Variables:`);
      Object.entries(payload.variables).forEach(([key, value]) => {
        console.log(`  - ${key}: ${value}`);
      });
    }
    
    // If it's a direct message, show the text
    if (payload.message) {
      console.log(`Message Text: "${payload.message}"`);
    }
    
    // Show what the actual SMS will say if it's a template
    if (payload.template) {
      const { data: template } = await supabase
        .from('table_booking_sms_templates')
        .select('template_text')
        .eq('template_key', payload.template)
        .eq('is_active', true)
        .single();
        
      if (template) {
        let messageText = template.template_text;
        
        // Replace variables
        if (payload.variables) {
          Object.entries(payload.variables).forEach(([key, value]) => {
            messageText = messageText.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
          });
        }
        
        console.log(`\n📝 ACTUAL MESSAGE THAT WILL BE SENT:`);
        console.log(`"${messageText}"`);
      }
    }
    
    console.log('\n');
  }
  
  console.log('=' .repeat(80));
  console.log('\n⚠️  THESE MESSAGES HAVE NOT BEEN SENT YET');
  console.log('\nOptions:');
  console.log('1. To SEND these messages, run: tsx scripts/process-sms-jobs.ts');
  console.log('2. To DELETE these messages, run: tsx scripts/delete-pending-sms.ts');
  console.log('3. To do nothing, just close this terminal');
}

// Run the check
showPendingSMS().catch(console.error);