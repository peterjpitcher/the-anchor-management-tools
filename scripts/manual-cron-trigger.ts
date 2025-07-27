#!/usr/bin/env tsx
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function triggerCron() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://management.orangejelly.co.uk';
  const cronSecret = process.env.CRON_SECRET;
  
  console.log('🔄 Manually triggering cron job...\n');
  
  try {
    const response = await fetch(`${baseUrl}/api/jobs/process`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cronSecret}`,
        'x-vercel-cron': '1'
      }
    });
    
    const text = await response.text();
    console.log(`Response: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      try {
        const data = JSON.parse(text);
        console.log('✅ Success:', data);
      } catch {
        console.log('Response:', text);
      }
    } else {
      console.log('❌ Error:', text);
    }
  } catch (error) {
    console.error('Failed to trigger cron:', error);
  }
}

// Run every 5 minutes if --continuous flag is passed
if (process.argv.includes('--continuous')) {
  console.log('Running in continuous mode (every 5 minutes)...');
  triggerCron();
  setInterval(triggerCron, 5 * 60 * 1000);
} else {
  triggerCron();
}