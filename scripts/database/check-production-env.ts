#!/usr/bin/env tsx

import * as dotenv from 'dotenv';
import path from 'path';
import fetch from 'node-fetch';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkProductionEnv() {
  console.log('🔍 CHECKING PRODUCTION ENVIRONMENT\n');
  console.log('=' + '='.repeat(50) + '\n');

  console.log('📋 Critical Environment Variables for SMS:\n');
  
  console.log('1. TWILIO CONFIGURATION (required for SMS):');
  console.log('   - TWILIO_ACCOUNT_SID');
  console.log('   - TWILIO_AUTH_TOKEN');
  console.log('   - TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID');
  console.log('   - TWILIO_WEBHOOK_AUTH_TOKEN');
  
  console.log('\n2. VERIFICATION STEPS:');
  console.log('   a) Go to: https://vercel.com/dashboard');
  console.log('   b) Select your project: the-anchor-management-tools');
  console.log('   c) Go to: Settings > Environment Variables');
  console.log('   d) Verify ALL Twilio variables are set for Production');
  
  console.log('\n3. COMMON ISSUES:');
  console.log('   ❌ Variables only set for Preview/Development');
  console.log('   ❌ Variables have extra spaces or quotes');
  console.log('   ❌ TWILIO_AUTH_TOKEN is incorrect (regenerate if needed)');
  console.log('   ❌ No sender configured (need phone or messaging service)');
  
  console.log('\n4. TO ADD/UPDATE VARIABLES:');
  console.log('   a) In Vercel dashboard, go to Environment Variables');
  console.log('   b) Add each variable with "Production" scope selected');
  console.log('   c) Click "Save"');
  console.log('   d) IMPORTANT: Redeploy for changes to take effect!');
  
  console.log('\n5. TO GET TWILIO CREDENTIALS:');
  console.log('   a) Go to: https://console.twilio.com');
  console.log('   b) Account SID and Auth Token are on dashboard');
  console.log('   c) Phone Numbers > Manage > Active Numbers for sender');
  console.log('   d) Or use Messaging Services for better deliverability');
  
  // Test API health endpoint
  console.log('\n\n🔍 TESTING API HEALTH...\n');
  
  try {
    const response = await fetch('https://management.orangejelly.co.uk/api/health', {
      method: 'GET',
    });
    
    if (response.status === 404) {
      console.log('⚠️  No health endpoint found (this is normal)');
    } else {
      console.log(`✅ API responded with status: ${response.status}`);
      const text = await response.text();
      if (text) {
        try {
          const data = JSON.parse(text);
          console.log('Response:', data);
        } catch (e) {
          console.log('Response (text):', text);
        }
      }
    }
  } catch (error: any) {
    console.error('❌ Failed to reach API:', error.message);
  }
  
  console.log('\n\n📋 IMMEDIATE ACTION REQUIRED:');
  console.log('1. Check Vercel Environment Variables NOW');
  console.log('2. Ensure ALL Twilio variables are set for Production');
  console.log('3. If any are missing, add them and REDEPLOY');
  console.log('4. Run test script after deployment:');
  console.log('   tsx scripts/test-booking-api.ts');
}

checkProductionEnv().catch(console.error);