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

async function checkSMSTemplates() {
  console.log('📱 Checking SMS Templates\n');
  console.log('=' .repeat(60));
  
  try {
    const { data: templates, error } = await supabase
      .from('table_booking_sms_templates')
      .select('*')
      .order('template_key');

    if (error) {
      console.error('❌ Error fetching templates:', error);
      return;
    }

    if (!templates || templates.length === 0) {
      console.log('⚠️  No SMS templates found');
      return;
    }

    console.log(`Found ${templates.length} templates:\n`);

    for (const template of templates) {
      console.log(`📝 Template: ${template.template_key}`);
      console.log(`   Type: ${template.booking_type || 'all'}`);
      console.log(`   Active: ${template.is_active ? '✅' : '❌'}`);
      console.log(`   Text: ${template.template_text}`);
      console.log(`   Variables: ${template.variables?.join(', ') || 'none'}`);
      console.log('');
    }

    // Check specifically for payment_request template
    const paymentTemplate = templates.find(t => t.template_key === 'payment_request');
    if (paymentTemplate) {
      console.log('✅ Payment request template exists');
      console.log('   Content:', paymentTemplate.template_text);
    } else {
      console.log('⚠️  No payment_request template found - need to create one!');
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Run the check
checkSMSTemplates();